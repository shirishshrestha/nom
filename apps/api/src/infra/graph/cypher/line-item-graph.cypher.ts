import { GRAPH_NODES, GRAPH_RELS } from '../graph-labels';

/**
 * Write extracted billed line items under their transaction document. The line item
 * carries the extraction model's first-pass match guess (`initial*`); the actual
 * BILLED_AS / REFERENCES edges are written later by the reconciler (see below).
 *
 * Per row:
 * - `LineItem`: MERGEd on `(id, tenantId)`. `invoiceRef` groups lines of the same
 *   invoice within a multi-invoice bundle. The a–z audit trail and match reasoning
 *   live in Postgres (pipeline_logs / pipeline_reasoning), not on the node.
 * - `HAS_LINE_ITEM` ← the transaction document.
 * - `HAS_ATTRIBUTES` → a per-line attribute bag (mirrors Service), so arbitrary
 *   attribute keys never collide with the structured LineItem fields.
 *
 * ponytail: lines group by the `invoiceRef` property (flat). If reconciliation later
 * needs per-invoice identity, promote to (d)-[:HAS_INVOICE]->(:Invoice)-[:HAS_LINE_ITEM]->(li).
 */
export const WRITE_LINE_ITEMS_CYPHER = `
MATCH (d:${GRAPH_NODES.TransactionDocument} {id:$documentId, tenantId:$tenantId})
// Re-extract is delete-and-replace: drop this document's previous line items (and
// their attribute bags) that are not part of the incoming rows, so stale verdicts
// never linger next to the fresh extraction. DETACH also severs incoming REFERENCES.
CALL {
  WITH d
  MATCH (d)-[:${GRAPH_RELS.HAS_LINE_ITEM}]->(old:${GRAPH_NODES.LineItem})
  WHERE NOT old.id IN $ids
  OPTIONAL MATCH (old)-[:${GRAPH_RELS.HAS_ATTRIBUTES}]->(oa:${GRAPH_NODES.Attributes})
  DETACH DELETE old, oa
  RETURN count(old) AS staleCount
}
WITH d
UNWIND $rows AS row
  MERGE (li:${GRAPH_NODES.LineItem} {id:row.id, tenantId:$tenantId})
    ON CREATE SET li.createdAt=$now
    SET li.description=row.description, li.invoiceRef=row.invoiceRef,
        li.sectionLabel=row.sectionLabel, li.sectionContext=row.sectionContext,
        li.documentId=$documentId,
        li.attributeSet=$attributeSet, li.foundAt=row.foundAt,
        li.sourceText=row.sourceText,
        li.initialKind=row.initialKind, li.initialCanonical=row.initialCanonical,
        li.initialTierSlug=row.initialTierSlug, li.initialRefSummary=row.initialRefSummary,
        li.formula=row.formula, li.symbols=row.symbols, li.taxable=row.taxable,
        li.taxPercentage=row.taxPercentage
  MERGE (d)-[:${GRAPH_RELS.HAS_LINE_ITEM}]->(li)
  MERGE (li)-[:${GRAPH_RELS.HAS_ATTRIBUTES}]->(a:${GRAPH_NODES.Attributes} {lineItemId:row.id, tenantId:$tenantId})
    SET a += row.attributes, a.attributeSet=$attributeSet
RETURN count(DISTINCT li) AS lineItemCount`;

/**
 * The projection shared by the whole-document and single-section reads: attribute bag,
 * matched rate-card line, sibling descriptions, and the extraction-time `initial*` guess,
 * grouped by invoice in document order. Assumes `li` is already bound by the caller.
 */
const LINE_ITEM_PROJECTION = `
OPTIONAL MATCH (li)-[:${GRAPH_RELS.HAS_ATTRIBUTES}]->(a:${GRAPH_NODES.Attributes})
OPTIONAL MATCH (li)-[ba:${GRAPH_RELS.BILLED_AS}]->(cs:${GRAPH_NODES.CanonicalService})
// The priced rate-card line behind the match: the current Service of the same
// canonical whose tier band equals the resolved tier on the BILLED_AS edge.
OPTIONAL MATCH (cs)<-[:${GRAPH_RELS.IS_A}]-(ms:${GRAPH_NODES.Service} {current:true, tenantId:$tenantId})
  WHERE coalesce(ms.tierSlug, '') = coalesce(ba.tierSlug, '')
OPTIONAL MATCH (ms)-[:${GRAPH_RELS.HAS_ATTRIBUTES}]->(msa:${GRAPH_NODES.Attributes})
CALL {
  WITH li
  OPTIONAL MATCH (li)-[:${GRAPH_RELS.REFERENCES}]->(ref:${GRAPH_NODES.LineItem})
  RETURN collect(ref.description) AS references
}
RETURN li.id AS id, li.description AS description, li.invoiceRef AS invoiceRef,
       li.sectionLabel AS sectionLabel, li.sectionContext AS sectionContext,
       li.foundAt AS foundAt,
       li.sourceText AS sourceText,
       li.initialKind AS initialKind, li.initialCanonical AS initialCanonical,
       li.initialTierSlug AS initialTierSlug, li.initialRefSummary AS initialRefSummary,
       li.formula AS formula, li.symbols AS symbols, li.taxable AS taxable,
       li.taxPercentage AS taxPercentage,
       li.matchKind AS matchKind, li.status AS status, li.acceptedFrom AS acceptedFrom,
       li.expectedAmount AS expectedAmount, li.billedAmount AS billedAmount,
       li.reviewNote AS reviewNote, li.narrative AS narrative, li.guidance AS guidance,
       cs.canonicalName AS matchedCanonicalName, ba.tierSlug AS matchedTierSlug,
       ms.tier AS matchedTier, ms.title AS matchedServiceTitle,
       ms.pricingContext AS matchedPricingContext,
       properties(msa) AS matchedServiceAttributes,
       references,
       properties(a) AS attributes
ORDER BY li.invoiceRef, li.sectionLabel`;

/**
 * All line items billed by one transaction document.
 */
export const DOCUMENT_LINE_ITEMS_CYPHER = `
MATCH (d:${GRAPH_NODES.TransactionDocument} {id:$documentId, tenantId:$tenantId})-[:${GRAPH_RELS.HAS_LINE_ITEM}]->(li:${GRAPH_NODES.LineItem})
${LINE_ITEM_PROJECTION}`;

/**
 * The line items of the ONE invoice section that contains $lineItemId — the sibling
 * boundary for a single-line rerun (invoiceRef == sectionLabel per the extractor). Empty
 * when the id is foreign to the document (the first MATCH fails).
 */
export const SECTION_LINE_ITEMS_CYPHER = `
MATCH (d:${GRAPH_NODES.TransactionDocument} {id:$documentId, tenantId:$tenantId})-[:${GRAPH_RELS.HAS_LINE_ITEM}]->(target:${GRAPH_NODES.LineItem} {id:$lineItemId})
WITH d, target.invoiceRef AS ref
MATCH (d)-[:${GRAPH_RELS.HAS_LINE_ITEM}]->(li:${GRAPH_NODES.LineItem} {invoiceRef: ref})
${LINE_ITEM_PROJECTION}`;

/**
 * Phase 2 — persist the reconciler's verdict. Three independent passes wrapped in
 * `CALL {}` subqueries so each is isolated: an empty input array yields a 0 count
 * row instead of collapsing the whole result (the empty-UNWIND footgun).
 *
 * - `$rows`         every line item: finalise `matchKind` and overwrite `formula` /
 *                    `symbols` with the adjudicator's accepted values (reasoning + audit
 *                    log go to Postgres pipeline_reasoning / pipeline_logs, not the node).
 * - `$serviceMatches` MERGE `(li)-[:BILLED_AS]->(c:CanonicalService)`, carrying the
 *                    resolved tier on the edge. Anchors on the vendor's canonical node
 *                    (stable across rate-card amendments), not a versioned Service.
 * - `$references`    MERGE `(li)-[:REFERENCES]->(sibling)` per resolved sibling id.
 */
export const WRITE_LINE_ITEM_MATCHES_CYPHER = `
WITH $rows AS rows, $serviceMatches AS serviceMatches, $references AS references
CALL {
  WITH rows
  UNWIND rows AS row
    MATCH (li:${GRAPH_NODES.LineItem} {id:row.id, tenantId:$tenantId})
    SET li.matchKind=row.matchKind, li.formula=row.formula, li.symbols=row.symbols
    WITH li
    // Rematch: drop this line's prior match edges so a changed verdict doesn't leave
    // stale BILLED_AS / REFERENCES alongside the ones the passes below re-MERGE.
    OPTIONAL MATCH (li)-[stale:${GRAPH_RELS.BILLED_AS}|${GRAPH_RELS.REFERENCES}]->()
    DELETE stale
  RETURN count(DISTINCT li) AS updatedCount
}
CALL {
  WITH serviceMatches
  UNWIND serviceMatches AS m
    MATCH (li:${GRAPH_NODES.LineItem} {id:m.lineItemId, tenantId:$tenantId})
    MATCH (c:${GRAPH_NODES.CanonicalService} {canonicalName:m.canonicalName, vendorId:$vendorId, tenantId:$tenantId})
    MERGE (li)-[r:${GRAPH_RELS.BILLED_AS}]->(c)
      SET r.tierSlug=m.tierSlug
  RETURN count(r) AS billedCount
}
CALL {
  WITH references
  UNWIND references AS ref
    MATCH (a:${GRAPH_NODES.LineItem} {id:ref.fromId, tenantId:$tenantId})
    MATCH (b:${GRAPH_NODES.LineItem} {id:ref.toId, tenantId:$tenantId})
    MERGE (a)-[rr:${GRAPH_RELS.REFERENCES}]->(b)
  RETURN count(rr) AS refCount
}
RETURN updatedCount, billedCount, refCount`;

/**
 * Phase 3 — persist resolved formula symbols onto already-matched line items. `symbols`
 * is a JSON string (mirrors the extract write). `formula` is rewritten only by the
 * referenced-expression composer (`coalesce` keeps the existing formula when a row carries
 * none). The resolution provenance is appended to Postgres pipeline_logs by the flow.
 */
export const WRITE_RESOLVED_SYMBOLS_CYPHER = `
UNWIND $rows AS row
  MATCH (li:${GRAPH_NODES.LineItem} {id:row.id, tenantId:$tenantId})
  SET li.symbols = row.symbols,
      li.formula = coalesce(row.formula, li.formula)
RETURN count(li) AS updatedCount`;

/**
 * Phase 4 — persist the amount-reconciler's verdict: set each line's review `status`
 * (match / mismatch / needs_review), the expected/billed amounts, and the review note.
 * The expected-vs-billed provenance is appended to Postgres pipeline_logs by the flow.
 */
export const WRITE_RECONCILIATION_CYPHER = `
UNWIND $rows AS row
  MATCH (li:${GRAPH_NODES.LineItem} {id:row.id, tenantId:$tenantId})
  SET li.status = row.status,
      li.expectedAmount = row.expectedAmount,
      li.billedAmount = row.billedAmount,
      li.reviewNote = row.reviewNote,
      li.narrative = row.narrative
RETURN count(li) AS updatedCount`;

/**
 * A reviewer's persistent correction for one line item — natural-language text stored on
 * the node so it applies to every future rerun (whole-doc or single-line). Distinct from
 * the vendor's phase-level `rules`. Matched by (id, documentId, tenantId) so a stale id
 * can't be written.
 */
export const WRITE_LINE_ITEM_GUIDANCE_CYPHER = `
MATCH (d:${GRAPH_NODES.TransactionDocument} {id:$documentId, tenantId:$tenantId})-[:${GRAPH_RELS.HAS_LINE_ITEM}]->(li:${GRAPH_NODES.LineItem} {id:$lineItemId})
  SET li.guidance = $guidance
RETURN count(li) AS updatedCount`;

/**
 * A reviewer's acceptance of a line's discrepancy: flip `status` to 'accepted' and keep the
 * status it was accepted from on `acceptedFrom` for the audit trail. Idempotent — a second
 * accept leaves `acceptedFrom` at the original prior status (never overwrites it with
 * 'accepted'). Returns `priorStatus` so the caller can skip re-logging a no-op accept.
 * Matched by (id, documentId, tenantId) so a stale id can't be written.
 */
export const WRITE_LINE_ITEM_ACCEPT_CYPHER = `
MATCH (d:${GRAPH_NODES.TransactionDocument} {id:$documentId, tenantId:$tenantId})-[:${GRAPH_RELS.HAS_LINE_ITEM}]->(li:${GRAPH_NODES.LineItem} {id:$lineItemId})
WITH li, li.status AS prior
  SET li.acceptedFrom = CASE WHEN prior = 'accepted' THEN li.acceptedFrom ELSE prior END,
      li.status = 'accepted'
RETURN prior AS priorStatus, count(li) AS updatedCount`;

/**
 * Dashboard rollup — one bounded per-tenant scan over the last 60 days of line items,
 * bucketed into the current 30-day window (createdAt >= $since) and the prior 30 days
 * (the trend baseline). Returns the six card scalars for each window (12 total):
 * match/mismatch/needs_review counts, adjudicated total, summed positive overcharge,
 * distinct document count. `count(CASE WHEN cur THEN li.status END)` counts non-null
 * statuses in the window = lines that have been through matching. createdAt is an
 * ISO-8601 UTC string, so lexicographic `>=` is chronological.
 * ponytail: legacy nodes without createdAt fall out of both windows (older than 60 days).
 */
export const TENANT_LINE_ITEM_STATS_CYPHER = `
MATCH (li:${GRAPH_NODES.LineItem} {tenantId:$tenantId})
WHERE li.createdAt >= $priorSince
WITH li, (li.createdAt >= $since) AS cur
RETURN
  count(CASE WHEN cur THEN li.status END) AS adjudicated,
  sum(CASE WHEN cur AND li.status='match' THEN 1 ELSE 0 END) AS matchCount,
  sum(CASE WHEN cur AND li.status='mismatch' THEN 1 ELSE 0 END) AS mismatchCount,
  sum(CASE WHEN cur AND li.status='needs_review' THEN 1 ELSE 0 END) AS needsReviewCount,
  sum(CASE WHEN cur AND li.expectedAmount IS NOT NULL AND li.billedAmount IS NOT NULL
           AND li.billedAmount > li.expectedAmount
           THEN li.billedAmount - li.expectedAmount ELSE 0 END) AS overchargeSum,
  count(DISTINCT CASE WHEN cur THEN li.documentId END) AS documentCount,
  count(CASE WHEN NOT cur THEN li.status END) AS priorAdjudicated,
  sum(CASE WHEN NOT cur AND li.status='match' THEN 1 ELSE 0 END) AS priorMatchCount,
  sum(CASE WHEN NOT cur AND li.status='mismatch' THEN 1 ELSE 0 END) AS priorMismatchCount,
  sum(CASE WHEN NOT cur AND li.status='needs_review' THEN 1 ELSE 0 END) AS priorNeedsReviewCount,
  sum(CASE WHEN NOT cur AND li.expectedAmount IS NOT NULL AND li.billedAmount IS NOT NULL
           AND li.billedAmount > li.expectedAmount
           THEN li.billedAmount - li.expectedAmount ELSE 0 END) AS priorOverchargeSum,
  count(DISTINCT CASE WHEN NOT cur THEN li.documentId END) AS priorDocumentCount`;
