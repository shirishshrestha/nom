import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ContentEntity, DocumentEntity } from '@nom/database';
import { DOCUMENT_STATUSES, RULE_CATEGORIES } from '@nom/shared';
import type { DocumentMetadata, LineItem } from '@nom/shared';
import type { ExtractLineItemsResultDto, LineItemDto } from '@nom/dtos';
import { toAttributeSetDto, type AttributeSet } from '../../attribute-set';
import type { OrgSession } from '../../auth/auth.types.js';
import { DocumentContextLoader } from '../../shared-loading/document-context.loader';
import { LineItemGraphRepository } from '../../infra/graph/line-item-graph.repository';
import {
  CanonicalRegistryRepository,
  type CanonicalRegistryEntry,
  type TierRegistryEntry,
} from '../../infra/graph/canonical-registry.repository';
import { stripNuls } from '../../common/text';
import { LineItemExtractor } from './line-item-extractor';
import { PipelineLogRepository } from '../persistence/pipeline-log.repository';
import { RulesService } from '../../rules/rules.service';

/**
 * State threaded through every step of the extract flow — each facade method returns an
 * updated copy. Fields are filled progressively; `run` guarantees a step's inputs are
 * set before it reads them.
 */
export interface ExtractState {
  readonly organizationId: string;
  readonly documentId: string;
  vendorId: string;
  attributeSet: AttributeSet | null;
  metadata: DocumentMetadata;
  sections: ContentEntity[];
  fileName: string;
  registry: CanonicalRegistryEntry[];
  tiers: TierRegistryEntry[];
  items: LineItem[];
  now: string;
}

/**
 * Extract a validated document's billed line items (with a first-pass match guess
 * against the vendor's rate card) and persist them to the graph, phase by phase. Each
 * method is a thin facade over ONE injected collaborator (SRP); `run` composes them.
 * Split out of TransactionService so the steps stay uniform, mirroring TransactionMatchFlow.
 */
@Injectable()
export class TransactionExtractFlow {
  private readonly logger = new Logger(TransactionExtractFlow.name);

  constructor(
    @InjectRepository(DocumentEntity)
    private readonly documentsRepo: Repository<DocumentEntity>,
    private readonly loader: DocumentContextLoader,
    private readonly extractor: LineItemExtractor,
    private readonly canonicalRegistry: CanonicalRegistryRepository,
    private readonly lineItemGraph: LineItemGraphRepository,
    private readonly pipelineLog: PipelineLogRepository,
    private readonly rulesService: RulesService,
  ) {}

  async run(
    session: OrgSession,
    documentId: string,
  ): Promise<ExtractLineItemsResultDto> {
    let s = this.seed(session.session.activeOrganizationId, documentId);
    s = await this.loadContext(s);
    s = await this.markProcessing(s);
    s = await this.loadRegistry(s);
    s = await this.extract(s);
    s = await this.persistLineItems(s);
    s = await this.markCommitted(s);
    return this.toResult(s);
  }

  private seed(organizationId: string, documentId: string): ExtractState {
    return {
      organizationId,
      documentId,
      vendorId: '',
      attributeSet: null,
      metadata: { isFinancial: false, attributeSet: null },
      sections: [],
      fileName: '',
      registry: [],
      tiers: [],
      items: [],
      now: '',
    };
  }

  /** loader.loadTransactionContext — the gated source doc, its sections, and file. */
  async loadContext(s: ExtractState): Promise<ExtractState> {
    this.logger.log(`extract line-items start doc=${s.documentId}`);
    const { document, set, sections, file } =
      await this.loader.loadTransactionContext(s.organizationId, s.documentId);
    return {
      ...s,
      vendorId: document.vendorId ?? '',
      attributeSet: set,
      metadata: document.metadata,
      sections,
      fileName: file?.name ?? '',
    };
  }

  /** documentsRepo.update — flag the document as PROCESSING before extraction. */
  async markProcessing(s: ExtractState): Promise<ExtractState> {
    await this.documentsRepo.update(
      { id: s.documentId, organizationId: s.organizationId },
      { status: DOCUMENT_STATUSES.PROCESSING },
    );
    return s;
  }

  /**
   * canonicalRegistry — vendor-scoped registry context so the extractor can assign each
   * line its initial match. Empty for an unknown vendor (every line → unmatched / sibling).
   */
  async loadRegistry(s: ExtractState): Promise<ExtractState> {
    const [registry, tiers] = await Promise.all([
      this.canonicalRegistry.findForVendor(s.organizationId, s.vendorId),
      this.canonicalRegistry.tiersForVendor(s.organizationId, s.vendorId),
    ]);
    return { ...s, registry, tiers };
  }

  /** extractor.extract — turn the sections into billed line items + stamp the write time. */
  async extract(s: ExtractState): Promise<ExtractState> {
    // Score extraction rules against the actual chunk text (which carries the line
    // wording a rule targets), not the lossy doc summary; fall back to summary/filename
    // when there are no sections. ponytail: capped to ~4000 chars — the Neo4j fulltext
    // query tokenizes into Lucene SHOULD clauses (default max 1024); raise the cap or
    // pre-dedupe terms if rule-relevance visibly suffers on very long documents.
    const sectionText = s.sections
      .map((c) => `${c.label} ${c.text}`)
      .join(' ')
      .slice(0, 4000);
    const ruleQuery = sectionText || s.metadata.summary || s.fileName;
    const selected = s.vendorId
      ? await this.rulesService.rulesFor(
          s.organizationId,
          s.vendorId,
          RULE_CATEGORIES.LINE_ITEM_EXTRACTION,
          ruleQuery,
        )
      : undefined;
    const items = await this.extractor.extract(
      s.attributeSet!,
      s.sections,
      s.registry,
      s.tiers,
      s.metadata,
      selected?.text,
    );
    if (selected)
      await this.rulesService.markRulesApplied({
        tenantId: s.organizationId,
        documentId: s.documentId,
        documentType: s.attributeSet!.documentType,
        category: RULE_CATEGORIES.LINE_ITEM_EXTRACTION,
        ruleIds: selected.ruleIds,
      });
    const now = new Date().toISOString();
    items.forEach((it) => it.log.push(`written to graph @ ${now}`));
    return { ...s, items, now };
  }

  /**
   * lineItemGraph.writeLineItems — persist the extracted line items to the graph; each
   * line's initial audit trail is appended to Postgres pipeline_logs.
   */
  async persistLineItems(s: ExtractState): Promise<ExtractState> {
    await this.lineItemGraph.writeLineItems({
      tenantId: s.organizationId,
      documentId: s.documentId,
      attributeSet: s.attributeSet!.key,
      now: s.now,
      rows: stripNuls(
        s.items.map((it) => ({
          id: it.id,
          description: it.description,
          invoiceRef: it.invoiceRef,
          sectionLabel: it.sectionLabel,
          sectionContext: it.meta.sectionContext,
          foundAt: it.meta.foundAt,
          sourceText: it.meta.sourceText,
          attributes: it.attributes,
          taxable: it.taxable,
          taxPercentage: it.taxPercentage,
          formula: it.formula,
          symbols: it.symbols === null ? null : JSON.stringify(it.symbols),
          initialKind: it.initialKind,
          initialCanonical: it.initialCanonical,
          initialTierSlug: it.initialTierSlug,
          initialRefSummary: it.initialRefSummary,
        })),
      ),
    });
    await this.pipelineLog.append({
      organizationId: s.organizationId,
      documentId: s.documentId,
      entries: s.items.map((it) => ({ entityId: it.id, messages: it.log })),
    });
    return s;
  }

  /** documentsRepo.update — flag the document COMMITTED once the graph write succeeds. */
  async markCommitted(s: ExtractState): Promise<ExtractState> {
    await this.documentsRepo.update(
      { id: s.documentId, organizationId: s.organizationId },
      { status: DOCUMENT_STATUSES.COMMITTED },
    );
    this.logger.log(
      `extracted ${s.items.length} line-item(s) doc=${s.documentId}, written to graph`,
    );
    return s;
  }

  private toResult(s: ExtractState): ExtractLineItemsResultDto {
    return {
      documentId: s.documentId,
      status: DOCUMENT_STATUSES.COMMITTED,
      fileName: s.fileName,
      attributeSet: toAttributeSetDto(s.attributeSet!),
      lineItems: s.items.map(toLineItemDto),
    };
  }
}

function toLineItemDto(item: LineItem): LineItemDto {
  return {
    id: item.id,
    description: item.description,
    invoiceRef: item.invoiceRef,
    sectionLabel: item.sectionLabel,
    attributes: item.attributes,
    foundAt: item.meta.foundAt,
    sourceText: item.meta.sourceText,
    status: null, // set later by the match flow's reconciliation phase
    acceptedFrom: null,
    matchKind: null,
    // Reconciliation/quotation panels are populated by the match flow; pre-match the
    // header carries only the raw formula, everything else null.
    reconciliation: {
      expectedAmount: null,
      billedAmount: null,
      difference: null,
      direction: null,
    },
    fromQuotation: null,
    howDetermined: item.formula
      ? {
          formula: item.formula,
          symbols: item.symbols,
          expectedAmount: null,
          billedAmount: null,
          difference: null,
        }
      : null,
    narrative: null,
    matchReasoning: null,
    reviewNote: null,
    guidance: null, // freshly extracted — no reviewer guidance yet
    references: [],
    taxable: item.taxable,
    taxPercentage: item.taxPercentage,
  };
}
