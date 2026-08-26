// A billed line item extracted from a transaction document (invoice / endorsement)
// and written into Neo4j as a :LineItem node. `invoiceRef` groups lines belonging to
// the same invoice within a multi-invoice bundle (== the originating chunk's label).
//
// Matching happens in two phases (mirrors ServiceExtractor → CanonicalMatcher):
//  - extraction time: the model assigns an `initial*` guess (no sibling UUIDs exist yet)
//  - match time: Haiku reconciles those into final BILLED_AS / REFERENCES graph edges

// How a billed line relates to the vendor's rate card:
//  - service_match: maps to a canonical service in the registry
//  - sibling_ref:   computed from other lines in the same invoice (e.g. "5% of PSA & Depot")
//  - unmatched:     no confident match
export const LINE_ITEM_MATCH_KINDS = {
  SERVICE_MATCH: 'service_match',
  SIBLING_REF: 'sibling_ref',
  UNMATCHED: 'unmatched',
} as const;

export type LineItemMatchKind =
  (typeof LINE_ITEM_MATCH_KINDS)[keyof typeof LINE_ITEM_MATCH_KINDS];

// Review disposition — orthogonal to matchKind (which says how a line relates to the
// rate card). Set by the match flow's reconciliation phase; `needs_review` drives a
// context-feed flow. null only before a document has been matched.
export const LINE_ITEM_STATUSES = {
  MATCH: 'match',
  MISMATCH: 'mismatch',
  NEEDS_REVIEW: 'needs_review',
  // Reviewer override: the discrepancy was acknowledged and accepted as-is. The status
  // it was accepted from is kept on the node's `acceptedFrom` for the audit trail.
  ACCEPTED: 'accepted',
} as const;

export type LineItemStatus =
  (typeof LINE_ITEM_STATUSES)[keyof typeof LINE_ITEM_STATUSES];

export interface LineItemMeta {
  foundAt: string | null; // LLM locator within the chunk
  sourceText: string; // verbatim snippet identifying this line — for UI highlighting
  contentId: string; // originating ContentEntity id — fetch the chunk on demand
  position: number; // chunk position in the document
  sectionContext: string | null; // section/invoice-level qualifier scoping this chunk's lines (for matching); null if none
}

// The extraction model's first-pass match guess. Stored on the node, then validated
// and turned into graph edges by the reconciler. `initialRefSummary` is free text
// because the sibling line UUIDs do not exist until every line has been extracted.
export interface LineItemInitialMatch {
  initialKind: LineItemMatchKind;
  initialCanonical: string | null; // canonicalName for service_match, else null
  initialTierSlug: string | null; // tier band for service_match, else null
  initialRefSummary: string | null; // which siblings, in words, for sibling_ref, else null
}

export interface LineItem extends LineItemInitialMatch {
  id: string; // uuid; becomes :LineItem.id in the graph
  description: string; // verbatim charge description
  invoiceRef: string; // which invoice this line belongs to (chunk label)
  sectionLabel: string; // chunk label this line was extracted from
  attributes: Record<string, string | number | null>; // per attribute-set bag (qty, unit_price, amount, ...)
  taxable: boolean; // structural (not in the dynamic attribute bag): is this line subject to tax/GST
  taxPercentage: number; // tax/GST rate as a percentage (e.g. 9 for "9% GST"); 0 when not taxed
  // How the amount is computed: a pure-arithmetic expression keeping the contracted unit
  // rate as the variable symbol `rate`, plus the symbol values known from the invoice
  // (`rate` is null until resolved from the matched service's rate card).
  formula: string | null;
  symbols: Record<string, number | null> | null;
  meta: LineItemMeta; // source provenance
  log: string[]; // a–z audit trail: what happened to this line through the flow
}
