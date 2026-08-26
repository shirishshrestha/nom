// Extracted service line-items staged for human review before they are promoted
// into the Neo4j knowledge graph. One StagedService == one (tier-split) catalogue
// line. `canonicalName`/`canonicalDescription` are INTERNAL — AI-derived grouping
// keys, never shown to or edited by reviewers (who edit attribute values only).

export interface StagedServiceMeta {
  foundAt: string | null; // LLM locator within the chunk
  sourceText: string; // verbatim snippet identifying this line — for UI highlighting
  contentId: string; // originating ContentEntity id — fetch the chunk on demand
  sectionLabel: string; // chunk label
  position: number; // chunk position in the document
  sectionContext: string | null; // section-level qualifier scoping this chunk's lines (for matching); null if none
}

export interface StagedService {
  id: string; // uuid; stable across edits → becomes :Service.id on save
  canonicalName: string; // INTERNAL — AI-derived grouping key; not human-editable
  canonicalDescription: string; // INTERNAL — AI-derived concept description
  title: string; // verbatim line title
  category: string | null; // free-form AI-assigned tag (not a fixed enum)
  tier: string | null; // band label; already its own row, just identifies the split
  tierSlug: string | null; // INTERNAL — normalized band key (reused across docs); amendment keys on canonicalName:tierSlug; null when untiered
  pricingContext: string; // calculation-relevant context for this line
  pricingRef: PricingRef | null; // when this line's price is derived from ANOTHER service; null when self-contained
  attributes: Record<string, string | number | null>; // per attribute-set bag
  meta: StagedServiceMeta; // source provenance for review
  log: string; // appendable audit trail (who/where/when)
}

// A cross-service pricing dependency: this line's charge is derived from another
// canonical service (e.g. "40% of Service A"). Detection captures WHICH service is
// referenced and the verbatim `relation` wording; the arithmetic is interpreted later
// at match time by the expression-composition phase, never locked to a fixed factor.
export interface PricingRef {
  referencedCanonical: string; // canonicalName of the service this price derives from
  referencedTierSlug: string | null; // pins the referenced tier when it is tiered; null when flat/unspecified
  relation: string; // verbatim relationship phrasing ("40% of A", "A plus 10", "A + 5% of value")
}

// The review-facing shape sent to the frontend — strips the internal canonical
// and tier-slug grouping keys. Reviewers may edit `attributes` only.
export type ReviewService = Omit<
  StagedService,
  'canonicalName' | 'canonicalDescription' | 'tierSlug'
>;

export const STAGED_ORIGINS = {
  EXTRACT: 'extract', // machine extraction
  SAVE: 'save', // human-reviewed snapshot
} as const;

export type StagedOrigin = (typeof STAGED_ORIGINS)[keyof typeof STAGED_ORIGINS];

// Lifecycle of a staged extraction row. Only one live (non-soft-deleted) row per
// document: `staged` (in review) ⇄ `ready_to_commit` (reviewer parked it, edits saved,
// not yet promoted) → `committed` (promoted to graph). Re-extract or a vendor-level
// discard retires the prior live row (staged OR ready_to_commit) to `superseded` +
// soft-delete. `staged` and `ready_to_commit` are the two LIVE (in-review) statuses.
export const STAGED_STATUSES = {
  STAGED: 'staged',
  READY: 'ready_to_commit',
  COMMITTED: 'committed',
  SUPERSEDED: 'superseded',
} as const;

export type StagedStatus =
  (typeof STAGED_STATUSES)[keyof typeof STAGED_STATUSES];

// Pricing-model classification for a canonical service group, shown on the rate-card
// list and used as a filter. Derived from the group's structure (tiered vs flat) and
// its pricing context; `Others` is reserved for models the heuristic can't classify.
export const SERVICE_MODELS = {
  FLAT: 'Flat',
  TIERED: 'Tiered',
  // Commented out until backed by real extraction — these were derived by fragile
  // keyword-sniffing of pricingContext (misfires on "duty-free", stray "%"/"value"),
  // so both the filter and the derivation only expose Flat/Tiered for now.
  // FREE_ALLOWANCE: 'Free allowance',
  // PERCENT_OF_VALUE: '% of value',
  // OTHERS: 'Others',
} as const;

export type ServiceModel =
  (typeof SERVICE_MODELS)[keyof typeof SERVICE_MODELS];
