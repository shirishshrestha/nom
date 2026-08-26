/**
 * A tier line carrying its raw attribute bag (e.g. the "20ft"/"40ft" rows of a
 * grouped service). Values are formatted for display by the attribute set's
 * `AttributeDef.type`, not pre-flattened — the table builds columns from the
 * set's schema. `label` is the optional tier qualifier.
 */
export type QuotationTier = {
  id: string
  label?: string
  attributes: Record<string, string | number | null>
}

export type Quotation = {
  id: string
  title: string
  code: string
  groupLabel?: string
  tiers: QuotationTier[]
  conditions: string
}

/**
 * Local mirror of CurrentServicesResultDto (GET /vendors/:id/services) —
 * same convention as `vendors` defining its own `Vendor` type.
 */
/**
 * Mirrors SERVICE_MODELS. The backend derives more models than it exposes —
 * Free allowance / % of value / Others are commented out there until the
 * derivation stops keyword-sniffing pricingContext, and `?model=` rejects them.
 */
export type ServiceModel = "Flat" | "Tiered"

export type CurrentService = {
  id: string
  canonicalName: string
  canonicalDescription: string | null
  category: string | null
  title: string
  tier: string | null
  tierSlug: string | null
  pricingContext: string
  model: ServiceModel
  attributes: Record<string, string | number | null>
  validFrom: string | null
  validTo: string | null
}

/**
 * CanonicalServiceGroupDto — GET /vendors/:id/services paginates over these
 * groups, not raw services.
 */
export type CurrentServiceGroup = {
  canonicalName: string
  canonicalDescription: string | null
  category: string | null
  services: CurrentService[]
}

/** QuotationFileDto — one source file the vendor's services were extracted from. */
export type QuotationFile = {
  fileId: string
  fileName: string
  uploadDate: string
}

export type CurrentServicesResult = {
  groupedServices: CurrentServiceGroup[]
  attributeSet: AttributeSet | null
  files: QuotationFile[]
  fileCount: number
  total: number
  limit: number
  offset: number
}

/**
 * Server-side filters for GET /vendors/:id/services; omitted keys mean "all".
 * The endpoint also takes `fileId`, but the files dropdown is a read-only list,
 * so nothing sends it.
 */
export type QuotationFilters = {
  q?: string
  model?: ServiceModel
}

export type DocumentStatus =
  | "pending"
  | "extracted"
  | "validated"
  | "staged"
  | "rejected"
  | "committed"
  | "discarded"

/**
 * AttributeDefDto — drives the dynamic edit form: `type` picks the input,
 * `nullable` whether it may be cleared.
 */
export type AttributeDef = {
  key: string
  label: string
  type: "string" | "number"
  nullable: boolean
}

export type AttributeSet = {
  key: string
  label: string
  documentType: string
  attributes: AttributeDef[]
}

/**
 * canonicalName/Description and tierSlug are stripped server-side;
 * `canonicalName` is optional here for the read-only "Name" field once the
 * backend surfaces it.
 */
export type ReviewService = {
  id: string
  canonicalName?: string
  title: string
  category: string | null
  tier: string | null
  pricingContext: string
  attributes: Record<string, string | number | null>
  meta: {
    foundAt: string | null
    sourceText: string
    contentId: string
    sectionLabel: string
    position: number
  }
  log: string
}

/**
 * Staged-row sub-status, distinct from the document's own `status`. A staged
 * doc is `staged` (in review) or `ready_to_commit` (reviewer parked, edits
 * saved, not yet promoted); `null` before the doc is staged.
 */
export type StagedStatus =
  | "staged"
  | "ready_to_commit"
  | "committed"
  | "superseded"

/** UncommittedDocumentDto — `services` is non-empty only when `status === "staged"`. */
export type UncommittedDocument = {
  documentId: string
  fileId: string
  fileName: string
  status: DocumentStatus
  effectiveFrom: string | null
  metadata: unknown
  services: ReviewService[]
  reviewStatus: StagedStatus | null
  stagedId: string | null
}

export type UncommittedResult = {
  documents: UncommittedDocument[]
  attributeSet: AttributeSet | null
}

/**
 * GET /source/uncommitted/latest — the most-recently-touched uncommitted doc
 * org-wide (for the "previous quotation incomplete" banner). All fields null
 * when nothing is in progress; vendorId is top-level (peer to document).
 */
export type LatestUncommittedResult = {
  document: UncommittedDocument | null
  vendorId: string | null
  attributeSet: AttributeSet | null
}

/**
 * Result of POST /source/documents/:id/validate. status is "validated" or
 * "rejected"; rejectReason is set only on rejection, warnings only on a
 * non-fatal vendor mismatch.
 */
export type ValidateResult = {
  /** documentId */
  id: string
  status: DocumentStatus
  warnings: string[]
  metadata: unknown
  rejectReason?: string
}

/** Committed via POST /source/documents/:id/save-services. */
export type SaveServiceItem = {
  id: string
  attributes: Record<string, string | number | null>
  title?: string
  pricingContext?: string
}

/** Result of POST mark-ready / unmark-ready. */
export type ReviewStatusResult = {
  documentId: string
  version: number
  reviewStatus: StagedStatus
}

/** GET /source/content/:contentId — the chunk a service line was extracted from. */
export type ContentChunk = {
  id: string
  label: string
  text: string
  position: number
  fileName: string
  page: number | null
  totalPages: number | null
}

/** Result of POST /source/commit-all — per-staged-row outcome. */
export type CommitAllResult = {
  committed: {
    stagedId: string
    documentId: string
    version: number
    serviceCount: number
    canonicalCount: number
  }[]
  failed: { stagedId: string; reason: string }[]
}
