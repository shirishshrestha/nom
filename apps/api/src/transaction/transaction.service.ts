import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Repository } from 'typeorm';
import { DocumentEntity } from '@nom/database';
import {
  DOCUMENT_STATUSES,
  DOCUMENT_TYPES,
  LINE_ITEM_STATUSES,
} from '@nom/shared';
import type {
  ExtractLineItemsResultDto,
  LineItemDto,
  LineItemLogDto,
  LineItemReasoningDto,
  MatchLineItemsResultDto,
  MatchQueuedDto,
  MatchStatusDto,
  TransactionLineItemsDto,
} from '@nom/dtos';
import type { OrgSession } from '../auth/auth.types.js';
import { reviewStatusOf } from '../documents/helpers/utils';
import {
  LineItemGraphRepository,
  type DocumentLineItem,
} from '../infra/graph/line-item-graph.repository';
import { logEntry } from './audit-log';
import { TransactionExtractFlow } from './extraction/extract-line-items.flow';
import { TransactionMatchFlow } from './matching/match-line-items.flow';
import { MATCH_QUEUE, type MatchJobData } from './matching/match.processor';
import { PipelineLogRepository } from './persistence/pipeline-log.repository';
import { PipelineReasoningRepository } from './persistence/pipeline-reasoning.repository';

@Injectable()
export class TransactionService {
  constructor(
    private readonly lineItemGraph: LineItemGraphRepository,
    private readonly extractFlow: TransactionExtractFlow,
    private readonly matchFlow: TransactionMatchFlow,
    private readonly pipelineLog: PipelineLogRepository,
    private readonly pipelineReasoning: PipelineReasoningRepository,
    @InjectQueue(MATCH_QUEUE) private readonly matchQueue: Queue<MatchJobData>,
    @InjectRepository(DocumentEntity)
    private readonly documentsRepo: Repository<DocumentEntity>,
  ) {}

  /**
   * Extract billed line items (with a first-pass match guess against the vendor's rate
   * card) and persist them to the graph. Orchestrated phase-by-phase in TransactionExtractFlow.
   */
  extractLineItems(
    session: OrgSession,
    documentId: string,
  ): Promise<ExtractLineItemsResultDto> {
    return this.extractFlow.run(session, documentId);
  }

  /**
   * Reconcile the committed line items against the vendor's rate card: link each to a
   * canonical service (BILLED_AS) or to the sibling lines its amount is computed from
   * (REFERENCES), resolve their formula symbols, and write the audit trail back onto
   * each node. Orchestrated phase-by-phase in TransactionMatchFlow.
   */
  async matchLineItems(
    session: OrgSession,
    documentId: string,
  ): Promise<MatchLineItemsResultDto | MatchQueuedDto> {
    const organizationId = session.session.activeOrganizationId;
    // Background path: flip to MATCHING and enqueue; the worker runs the flow and flips
    // to MATCHED. Poll GET .../line-items (+ doc status) for the result.
    if (process.env.TRANSACTION_MATCH_ASYNC === 'true') {
      await this.documentsRepo.update(
        { id: documentId, organizationId },
        { status: DOCUMENT_STATUSES.MATCHING },
      );
      await this.matchQueue.add('match', { organizationId, documentId });
      return { documentId, status: DOCUMENT_STATUSES.MATCHING };
    }
    return this.matchFlow.run(organizationId, documentId);
  }

  /**
   * The line items for a document, from the graph. Reasoning (from Postgres) is merged
   * inline; the audit `log` is NOT — it is fetched on demand via getLineItemLog so the
   * list response stays lean.
   */
  async getLineItems(
    organizationId: string,
    documentId: string,
  ): Promise<TransactionLineItemsDto> {
    const [lineItems, reasoning] = await Promise.all([
      this.lineItemGraph.listForDocument(organizationId, documentId),
      this.pipelineReasoning.listForDocument(organizationId, documentId),
    ]);
    return {
      documentId,
      lineItems: lineItems.map((li) => this.toDto(li, reasoning.get(li.id))),
    };
  }

  /**
   * Store a reviewer's guidance on a line item (persisted on the node) and re-run
   * matching for THAT line only. The guidance is re-applied on every future rerun.
   * Returns the updated line item. Runs inline — one line is cheap.
   */
  async submitLineItemGuidance(
    session: OrgSession,
    documentId: string,
    lineItemId: string,
    guidance: string,
  ): Promise<LineItemDto> {
    const organizationId = session.session.activeOrganizationId;
    const document = await this.documentsRepo.findOneBy({
      id: documentId,
      organizationId,
      documentType: DOCUMENT_TYPES.TRANSACTION,
    });
    if (!document)
      throw new NotFoundException('Transaction document not found');
    // Guidance only makes sense once the line items exist and can be re-matched.
    const rematchable: string[] = [
      DOCUMENT_STATUSES.COMMITTED,
      DOCUMENT_STATUSES.MATCHED,
    ];
    if (!rematchable.includes(document.status))
      throw new BadRequestException(
        `Line items must be extracted before guidance (status=${document.status})`,
      );

    await this.lineItemGraph.writeGuidance({
      tenantId: organizationId,
      documentId,
      lineItemId,
      guidance,
    });
    await this.matchFlow.runForLine(organizationId, documentId, lineItemId);

    const [lineItems, reasoning] = await Promise.all([
      this.lineItemGraph.listForDocument(organizationId, documentId),
      this.pipelineReasoning.listForDocument(organizationId, documentId),
    ]);
    const updated = lineItems.find((li) => li.id === lineItemId);
    if (!updated) throw new NotFoundException('Line item not found');
    return this.toDto(updated, reasoning.get(updated.id));
  }

  /**
   * Accept a line's discrepancy as-is: flip its status to 'accepted', record the status it was
   * accepted from on the node (`acceptedFrom`) for the audit trail, and append an audit-log
   * entry naming the reviewer and the prior status. Idempotent — a repeat accept is a success
   * with no duplicate log row. Returns the updated line item.
   */
  async acceptLineItem(
    session: OrgSession,
    documentId: string,
    lineItemId: string,
    reason?: string,
  ): Promise<LineItemDto> {
    const organizationId = session.session.activeOrganizationId;
    const document = await this.documentsRepo.findOneBy({
      id: documentId,
      organizationId,
      documentType: DOCUMENT_TYPES.TRANSACTION,
    });
    if (!document)
      throw new NotFoundException('Transaction document not found');
    // A line only carries a status to accept once the document has been matched.
    if (document.status !== DOCUMENT_STATUSES.MATCHED)
      throw new BadRequestException(
        `Line items must be matched before acceptance (status=${document.status})`,
      );

    const { priorStatus } = await this.lineItemGraph.acceptLineItem({
      tenantId: organizationId,
      documentId,
      lineItemId,
    });
    // Idempotent: a repeat accept (already 'accepted') adds no duplicate audit entry.
    if (priorStatus !== LINE_ITEM_STATUSES.ACCEPTED) {
      await this.pipelineLog.append({
        organizationId,
        documentId,
        entries: [
          {
            entityId: lineItemId,
            messages: [
              logEntry(
                `Accepted by ${session.user.id} — ${priorStatus ?? 'none'} → accepted.${reason ? ` Reason: ${reason}` : ''}`,
              ),
            ],
          },
        ],
      });
    }

    const [lineItems, reasoning] = await Promise.all([
      this.lineItemGraph.listForDocument(organizationId, documentId),
      this.pipelineReasoning.listForDocument(organizationId, documentId),
    ]);
    const updated = lineItems.find((li) => li.id === lineItemId);
    if (!updated) throw new NotFoundException('Line item not found');
    return this.toDto(updated, reasoning.get(updated.id));
  }

  /**
   * The document's current matching status — the poll endpoint the frontend hits after
   * starting background matching. `matching` = in flight, `matched` = done (fetch line items),
   * `committed` = not matching / reverted on failure.
   */
  async getMatchStatus(
    session: OrgSession,
    documentId: string,
  ): Promise<MatchStatusDto> {
    const organizationId = session.session.activeOrganizationId;
    const document = await this.documentsRepo.findOneBy({
      id: documentId,
      organizationId,
      documentType: DOCUMENT_TYPES.TRANSACTION,
    });
    if (!document)
      throw new NotFoundException('Transaction document not found');
    return {
      documentId,
      status: document.status,
      reviewStatus: reviewStatusOf(document.reviewCompleted),
    };
  }

  /** The full audit trail for one line item, on demand (Postgres pipeline_logs). */
  async getLineItemLog(
    organizationId: string,
    lineItemId: string,
  ): Promise<LineItemLogDto> {
    const log = await this.pipelineLog.listForEntity(
      organizationId,
      lineItemId,
    );
    return { lineItemId, log };
  }

  // Graph read → DTO, with the Postgres reasoning merged inline and the verdict grouped
  // into the reconciliation UI's panel sections. The audit log is never in the list
  // response — it is served on demand by getLineItemLog.
  private toDto(
    li: DocumentLineItem,
    reasoning: Record<string, unknown> | null | undefined,
  ): LineItemDto {
    const difference =
      li.expectedAmount != null && li.billedAmount != null
        ? round2(li.billedAmount - li.expectedAmount)
        : null;
    return {
      id: li.id,
      description: li.description,
      invoiceRef: li.invoiceRef,
      sectionLabel: li.sectionLabel,
      attributes: stripInternal(li.attributes),
      sourceText: li.sourceText,
      foundAt: li.foundAt,
      status: li.status,
      acceptedFrom: li.acceptedFrom,
      matchKind: li.matchKind,
      reconciliation: {
        expectedAmount: li.expectedAmount,
        billedAmount: li.billedAmount,
        difference,
        direction: directionOf(difference),
      },
      // "From Quotation": present only when a current rate-card Service matched.
      fromQuotation:
        li.matchedCanonicalName && li.matchedServiceAttributes
          ? {
              title: li.matchedServiceTitle,
              canonicalName: li.matchedCanonicalName,
              tierSlug: li.matchedTierSlug,
              tier: li.matchedTier,
              pricingContext: li.matchedPricingContext,
              attributes: stripInternal(li.matchedServiceAttributes),
            }
          : null,
      howDetermined: li.formula
        ? {
            formula: li.formula,
            symbols: li.symbols,
            expectedAmount: li.expectedAmount,
            billedAmount: li.billedAmount,
            difference,
          }
        : null,
      narrative: li.narrative ?? composeNarrative(li, difference),
      // The jsonb row is the match schema's reasoning shape; the store itself is
      // shape-agnostic, so the narrowing happens here at the DTO boundary.
      matchReasoning: (reasoning as LineItemReasoningDto | null) ?? null,
      reviewNote: li.reviewNote,
      guidance: li.guidance,
      references: li.references,
      taxable: li.taxable,
      taxPercentage: li.taxPercentage,
    };
  }
}

// 2-dp rounding so a float-subtraction artifact (185.00 - 140.00 = 44.999…) never
// reaches the UI.
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ponytail: denylist the graph/plumbing keys the Attributes node carries; everything
// else is a real display attribute. Add a key here if a new internal one appears.
const INTERNAL_ATTR_KEYS = new Set(['tenantId', 'serviceId', 'attributeSet']);
function stripInternal(
  attrs: Record<string, string | number | null> | null | undefined,
): Record<string, string | number | null> {
  return Object.fromEntries(
    Object.entries(attrs ?? {}).filter(([k]) => !INTERNAL_ATTR_KEYS.has(k)),
  );
}

function directionOf(
  difference: number | null,
): 'over' | 'under' | 'match' | null {
  if (difference == null) return null;
  if (difference > 0.005) return 'over';
  if (difference < -0.005) return 'under';
  return 'match';
}

// ponytail: a factual explanation composed from the numbers already on the line — no
// LLM call. Upgrade path: swap for an adjudicator-authored narrative if this reads thin.
function composeNarrative(
  li: DocumentLineItem,
  difference: number | null,
): string | null {
  if (li.status == null) return null;
  if (li.status === 'accepted')
    return `Accepted by reviewer${li.acceptedFrom ? ` — was ${li.acceptedFrom}` : ''}.`;
  if (li.status === 'needs_review')
    return (
      li.reviewNote ??
      'Needs review: insufficient context to verify this charge.'
    );
  if (li.expectedAmount == null || li.billedAmount == null)
    return li.reviewNote ?? 'Verified against the rate card.';

  const billed = li.billedAmount.toFixed(2);
  const expected = li.expectedAmount.toFixed(2);
  if (difference != null && difference > 0.005)
    return `Billed ${billed} exceeds the expected ${expected} by ${difference.toFixed(2)} — overcharged.`;
  if (difference != null && difference < -0.005)
    return `Billed ${billed} is below the expected ${expected} by ${Math.abs(difference).toFixed(2)} — undercharged.`;
  return `Billed ${billed} matches the expected ${expected}.`;
}
