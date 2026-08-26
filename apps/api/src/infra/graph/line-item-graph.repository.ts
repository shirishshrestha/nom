import { Injectable, Logger } from '@nestjs/common';
import { Neo4jService } from '@nom/neo4j';
import type { LineItemMatchKind, LineItemStatus } from '@nom/shared';
import type { Record as Neo4jRecord } from 'neo4j-driver';
import {
  DOCUMENT_LINE_ITEMS_CYPHER,
  SECTION_LINE_ITEMS_CYPHER,
  TENANT_LINE_ITEM_STATS_CYPHER,
  WRITE_LINE_ITEMS_CYPHER,
  WRITE_LINE_ITEM_ACCEPT_CYPHER,
  WRITE_LINE_ITEM_GUIDANCE_CYPHER,
  WRITE_LINE_ITEM_MATCHES_CYPHER,
  WRITE_RECONCILIATION_CYPHER,
  WRITE_RESOLVED_SYMBOLS_CYPHER,
} from './cypher/line-item-graph.cypher';
import {
  getAttributes,
  getNullableString,
  getNumber,
  getString,
} from './graph-record';
import { GraphWriteError } from './graph-error';

export interface LineItemGraphRow {
  id: string;
  description: string;
  invoiceRef: string;
  sectionLabel: string;
  sectionContext: string | null;
  foundAt: string | null;
  sourceText: string;
  attributes: Record<string, string | number | null>;
  taxable: boolean;
  taxPercentage: number;
  formula: string | null;
  symbols: string | null; // JSON-serialized Record<string, number|null> (Neo4j can't nest)
  initialKind: LineItemMatchKind;
  initialCanonical: string | null;
  initialTierSlug: string | null;
  initialRefSummary: string | null;
}

export interface WriteLineItemsInput {
  tenantId: string;
  documentId: string;
  attributeSet: string;
  now: string;
  rows: LineItemGraphRow[];
}

export interface DocumentLineItem {
  id: string;
  description: string;
  invoiceRef: string;
  sectionLabel: string;
  sectionContext: string | null;
  foundAt: string | null;
  sourceText: string;
  attributes: Record<string, string | number | null>;
  taxable: boolean;
  taxPercentage: number;
  formula: string | null;
  symbols: Record<string, number | null> | null;
  initialKind: LineItemMatchKind | null;
  initialCanonical: string | null;
  initialTierSlug: string | null;
  initialRefSummary: string | null;
  matchKind: LineItemMatchKind | null;
  status: LineItemStatus | null;
  acceptedFrom: LineItemStatus | null; // the status this line was accepted from; null unless accepted
  expectedAmount: number | null;
  billedAmount: number | null;
  reviewNote: string | null;
  narrative: string | null; // adjudicator-authored explanation; null for match lines / pre-narrative rows
  guidance: string | null; // reviewer's persistent per-line correction; null until submitted
  matchedCanonicalName: string | null; // from the BILLED_AS edge target
  matchedTierSlug: string | null; // resolved tier on the BILLED_AS edge
  matchedTier: string | null; // human tier label of the matched current Service
  matchedServiceTitle: string | null; // verbatim reviewer-editable title of the matched current Service
  matchedPricingContext: string | null; // pricing context of the matched current Service
  matchedServiceAttributes: Record<string, string | number | null> | null; // the priced bag (rate/premium, unit, currency); null unless a current Service matched
  references: string[]; // descriptions of the siblings this line REFERENCES
}

// One time-window's line-item rollup for the dashboard. Raw aggregates; the dashboard
// service derives the card values (accuracy, overcharge $, avg flags) from these.
export interface TenantWindowStats {
  adjudicated: number; // lines with a non-null review status (been through matching)
  matchCount: number;
  mismatchCount: number;
  needsReviewCount: number;
  overchargeSum: number; // Σ(billed − expected) over lines billed above expected
  documentCount: number; // distinct documents that have line items
}

// The current 30-day window (card values) plus the prior 30 days (trend baseline).
export interface TenantLineItemStats {
  current: TenantWindowStats;
  prior: TenantWindowStats;
}

// The reconciler's verdict for one document. `rows` finalise matchKind + log on
// every line; `serviceMatches` / `references` create the relationship edges.
export interface WriteMatchResultsInput {
  tenantId: string;
  vendorId: string;
  rows: Array<{
    id: string;
    matchKind: LineItemMatchKind;
    formula: string | null; // adjudicator's accepted formula (corrected or original)
    symbols: string | null; // JSON-serialized Record<string, number|null> (mirrors extract write)
  }>;
  serviceMatches: Array<{
    lineItemId: string;
    canonicalName: string;
    tierSlug: string | null;
  }>;
  references: Array<{ fromId: string; toId: string }>;
}

// Phase 3 — resolved formula symbols per line. `symbols` is JSON (mirrors the extract
// write); `logAdditions` are appended to the line's existing audit log.
export interface WriteResolvedSymbolsInput {
  tenantId: string;
  // `formula` is set only by the referenced-expression composer; omit/undefined leaves
  // the line's existing formula untouched (Cypher `coalesce`).
  rows: Array<{ id: string; symbols: string | null; formula?: string | null }>;
}

// Phase 4 — reconciliation verdict per line. `status` is the review disposition
// (match / mismatch / needs_review); `expectedAmount`/`billedAmount` are the numbers
// behind it; `reviewNote` states the missing context on needs_review lines;
// `logAdditions` are appended to the audit log.
export interface WriteReconciliationInput {
  tenantId: string;
  rows: Array<{
    id: string;
    status: LineItemStatus;
    expectedAmount: number | null;
    billedAmount: number | null;
    reviewNote: string | null;
    narrative: string | null; // adjudicator-authored prose; null for match lines / on failure
  }>;
}

// Writes extracted line items under their transaction document. FATAL by contract —
// the caller must let the error propagate so the document is not advanced. Throws
// when the write returns no record or wrote fewer line items than were supplied.
@Injectable()
export class LineItemGraphRepository {
  private readonly logger = new Logger(LineItemGraphRepository.name);

  constructor(private readonly neo4j: Neo4jService) {}

  async writeLineItems(input: WriteLineItemsInput): Promise<number> {
    const records = await this.neo4j.write(WRITE_LINE_ITEMS_CYPHER, {
      documentId: input.documentId,
      tenantId: input.tenantId,
      attributeSet: input.attributeSet,
      now: input.now,
      rows: input.rows,
      // Stale-cleanup guard: previous line items NOT in this set are deleted
      // (re-extract is delete-and-replace).
      ids: input.rows.map((r) => r.id),
    });

    const rec = records[0];
    if (!rec)
      throw new GraphWriteError(
        `Line-item write for document ${input.documentId} returned no result`,
      );

    const lineItemCount = getNumber(rec, 'lineItemCount');
    // The aggregating RETURN always yields one {0} row even when the initial
    // TransactionDocument MATCH found nothing — so a no-op write masquerades as
    // success. Assert every input row produced a LineItem node.
    if (input.rows.length > 0 && lineItemCount !== input.rows.length)
      throw new GraphWriteError(
        `Line-item write for document ${input.documentId} wrote ${lineItemCount}/${input.rows.length} line items`,
      );
    this.logger.debug(
      `graph wrote ${lineItemCount} line-item(s) doc=${input.documentId}`,
    );
    return lineItemCount;
  }

  // Persist the reconciler's match verdict: finalise matchKind + log on every line,
  // then create BILLED_AS / REFERENCES edges. FATAL by contract — a count mismatch
  // means a line item, canonical, or sibling the model named is missing from the
  // graph (registry drift), which must not be silently committed.
  async writeMatchResults(input: WriteMatchResultsInput): Promise<{
    updatedCount: number;
    billedCount: number;
    refCount: number;
  }> {
    const records = await this.neo4j.write(WRITE_LINE_ITEM_MATCHES_CYPHER, {
      tenantId: input.tenantId,
      vendorId: input.vendorId,
      rows: input.rows,
      serviceMatches: input.serviceMatches,
      references: input.references,
    });

    const rec = records[0];
    if (!rec)
      throw new GraphWriteError('Line-item match write returned no result');

    const updatedCount = getNumber(rec, 'updatedCount');
    const billedCount = getNumber(rec, 'billedCount');
    const refCount = getNumber(rec, 'refCount');

    if (updatedCount !== input.rows.length)
      throw new GraphWriteError(
        `Match write updated ${updatedCount}/${input.rows.length} line items`,
      );
    if (billedCount !== input.serviceMatches.length)
      throw new GraphWriteError(
        `Match write linked ${billedCount}/${input.serviceMatches.length} service matches — a canonical the model named is missing for this vendor`,
      );
    if (refCount !== input.references.length)
      throw new GraphWriteError(
        `Match write linked ${refCount}/${input.references.length} sibling references`,
      );
    return { updatedCount, billedCount, refCount };
  }

  // Persist the symbol-resolver's output: overwrite each line's `symbols` and append
  // the resolution provenance to its log. FATAL by contract — a count mismatch means a
  // line the resolver named is missing from the graph.
  async writeResolvedSymbols(
    input: WriteResolvedSymbolsInput,
  ): Promise<number> {
    if (input.rows.length === 0) return 0;
    const records = await this.neo4j.write(WRITE_RESOLVED_SYMBOLS_CYPHER, {
      tenantId: input.tenantId,
      rows: input.rows,
    });
    const rec = records[0];
    if (!rec)
      throw new GraphWriteError('Resolved-symbols write returned no result');
    const updatedCount = getNumber(rec, 'updatedCount');
    if (updatedCount !== input.rows.length)
      throw new GraphWriteError(
        `Resolved-symbols write updated ${updatedCount}/${input.rows.length} line items`,
      );
    return updatedCount;
  }

  // Persist the amount-reconciler's verdict: set each line's review `status` and append
  // the expected-vs-billed provenance to its log. FATAL by contract — a count mismatch
  // means a line the reconciler named is missing from the graph.
  async writeReconciliation(input: WriteReconciliationInput): Promise<number> {
    if (input.rows.length === 0) return 0;
    const records = await this.neo4j.write(WRITE_RECONCILIATION_CYPHER, {
      tenantId: input.tenantId,
      rows: input.rows,
    });
    const rec = records[0];
    if (!rec)
      throw new GraphWriteError('Reconciliation write returned no result');
    const updatedCount = getNumber(rec, 'updatedCount');
    if (updatedCount !== input.rows.length)
      throw new GraphWriteError(
        `Reconciliation write updated ${updatedCount}/${input.rows.length} line items`,
      );
    return updatedCount;
  }

  // Persist a reviewer's per-line guidance. FATAL by contract — a 0 update means the
  // line item does not belong to that document (a stale/foreign id).
  async writeGuidance(input: {
    tenantId: string;
    documentId: string;
    lineItemId: string;
    guidance: string;
  }): Promise<void> {
    const records = await this.neo4j.write(WRITE_LINE_ITEM_GUIDANCE_CYPHER, {
      tenantId: input.tenantId,
      documentId: input.documentId,
      lineItemId: input.lineItemId,
      guidance: input.guidance,
    });
    const rec = records[0];
    if (!rec || getNumber(rec, 'updatedCount') !== 1)
      throw new GraphWriteError(
        `Guidance write did not match line item ${input.lineItemId} on document ${input.documentId}`,
      );
  }

  // Accept a line's discrepancy: flip status to 'accepted' and record the prior status on
  // `acceptedFrom`. Idempotent — a repeat accept preserves the original acceptedFrom. Returns
  // the prior status so the caller can skip re-logging a no-op accept. FATAL by contract — a 0
  // update means the line item does not belong to that document (a stale/foreign id).
  async acceptLineItem(input: {
    tenantId: string;
    documentId: string;
    lineItemId: string;
  }): Promise<{ priorStatus: LineItemStatus | null }> {
    const records = await this.neo4j.write(WRITE_LINE_ITEM_ACCEPT_CYPHER, {
      tenantId: input.tenantId,
      documentId: input.documentId,
      lineItemId: input.lineItemId,
    });
    const rec = records[0];
    if (!rec || getNumber(rec, 'updatedCount') !== 1)
      throw new GraphWriteError(
        `Accept write did not match line item ${input.lineItemId} on document ${input.documentId}`,
      );
    return {
      priorStatus: getNullableString(
        rec,
        'priorStatus',
      ) as LineItemStatus | null,
    };
  }

  async listForDocument(
    tenantId: string,
    documentId: string,
  ): Promise<DocumentLineItem[]> {
    const records = await this.neo4j.read(DOCUMENT_LINE_ITEMS_CYPHER, {
      documentId,
      tenantId,
    });
    return records.map((r) => this.toLineItem(r));
  }

  // The line items of the one invoice section containing `lineItemId` (its sibling
  // boundary) — what a single-line rerun loads instead of the whole document. Empty when
  // the id is foreign to the document.
  async listForSectionOf(
    tenantId: string,
    documentId: string,
    lineItemId: string,
  ): Promise<DocumentLineItem[]> {
    const records = await this.neo4j.read(SECTION_LINE_ITEMS_CYPHER, {
      documentId,
      tenantId,
      lineItemId,
    });
    return records.map((r) => this.toLineItem(r));
  }

  // One bounded per-tenant scan feeding the dashboard cards, split into the current
  // 30-day window and the prior 30 days (trend baseline). `since`/`priorSince` are ISO
  // boundary strings. The aggregating RETURN always yields one row (all zeros when the
  // tenant has no line items in the span).
  async getTenantStats(
    tenantId: string,
    since: string,
    priorSince: string,
  ): Promise<TenantLineItemStats> {
    const records = await this.neo4j.read(TENANT_LINE_ITEM_STATS_CYPHER, {
      tenantId,
      since,
      priorSince,
    });
    const rec = records[0];
    const num = (key: string) => (rec ? getNumber(rec, key) : 0);
    return {
      current: {
        adjudicated: num('adjudicated'),
        matchCount: num('matchCount'),
        mismatchCount: num('mismatchCount'),
        needsReviewCount: num('needsReviewCount'),
        overchargeSum: num('overchargeSum'),
        documentCount: num('documentCount'),
      },
      prior: {
        adjudicated: num('priorAdjudicated'),
        matchCount: num('priorMatchCount'),
        mismatchCount: num('priorMismatchCount'),
        needsReviewCount: num('priorNeedsReviewCount'),
        overchargeSum: num('priorOverchargeSum'),
        documentCount: num('priorDocumentCount'),
      },
    };
  }

  private toLineItem(r: Neo4jRecord): DocumentLineItem {
    return {
      id: getString(r, 'id'),
      description: getString(r, 'description'),
      invoiceRef: getString(r, 'invoiceRef'),
      sectionLabel: getString(r, 'sectionLabel'),
      sectionContext: getNullableString(r, 'sectionContext'),
      foundAt: getNullableString(r, 'foundAt'),
      // Tolerate legacy nodes written before sourceText was persisted (null → "").
      sourceText: getNullableString(r, 'sourceText') ?? '',
      attributes: getAttributes(r, 'attributes'),
      // Legacy nodes written before the field default to false / 0.
      taxable: (r.get('taxable') as boolean | null) ?? false,
      taxPercentage:
        r.get('taxPercentage') == null ? 0 : getNumber(r, 'taxPercentage'),
      formula: getNullableString(r, 'formula'),
      symbols: JSON.parse(getNullableString(r, 'symbols') ?? 'null') as Record<
        string,
        number | null
      > | null,
      // Nullable — line items extracted before the matching feature have no initial*.
      initialKind: getNullableString(
        r,
        'initialKind',
      ) as LineItemMatchKind | null,
      initialCanonical: getNullableString(r, 'initialCanonical'),
      initialTierSlug: getNullableString(r, 'initialTierSlug'),
      initialRefSummary: getNullableString(r, 'initialRefSummary'),
      matchKind: getNullableString(r, 'matchKind') as LineItemMatchKind | null,
      // null until the document has been matched.
      status: getNullableString(r, 'status') as LineItemStatus | null,
      acceptedFrom: getNullableString(
        r,
        'acceptedFrom',
      ) as LineItemStatus | null,
      expectedAmount:
        r.get('expectedAmount') == null ? null : getNumber(r, 'expectedAmount'),
      billedAmount:
        r.get('billedAmount') == null ? null : getNumber(r, 'billedAmount'),
      reviewNote: getNullableString(r, 'reviewNote'),
      narrative: getNullableString(r, 'narrative'),
      guidance: getNullableString(r, 'guidance'),
      matchedCanonicalName: getNullableString(r, 'matchedCanonicalName'),
      matchedTierSlug: getNullableString(r, 'matchedTierSlug'),
      matchedTier: getNullableString(r, 'matchedTier'),
      matchedServiceTitle: getNullableString(r, 'matchedServiceTitle'),
      matchedPricingContext: getNullableString(r, 'matchedPricingContext'),
      // null (not {}) when no current Service matched, so toDto can gate fromQuotation.
      matchedServiceAttributes:
        r.get('matchedServiceAttributes') == null
          ? null
          : getAttributes(r, 'matchedServiceAttributes'),
      references: (r.get('references') as string[] | null) ?? [],
    };
  }
}
