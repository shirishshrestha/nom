import type {
  DocumentStatus,
  ReviewStatus,
} from "@/features/invoices/lib/invoice-status"

/**
 * Local mirror of DocumentListItemDto (GET /transaction/documents) — same
 * convention as `vendors` defining its own `Vendor` type. Only the fields this
 * list page reads; `metadata` on the wire carries far more than `total`/`currency`.
 */
export type InvoiceDocument = {
  documentId: string
  fileId: string
  fileName: string
  status: DocumentStatus
  reviewStatus: ReviewStatus
  vendorId: string | null
  effectiveFrom: string | null
  createdAt: string
  fileSizeBytes: number | null
  metadata: {
    total?: number
    currency?: string | null
  }
}

/** Local mirror of DocumentListDto (GET /transaction/documents). */
export type InvoiceDocumentsResult = {
  documents: InvoiceDocument[]
  totalCount: number
  page: number
  limit: number
}

export type LineItemStatus = "match" | "mismatch" | "needs_review" | "accepted"

export type LineItemMatchKind = "service_match" | "sibling_ref" | "unmatched"

/** Expected · Charged · Difference. All null before match-line-items runs. */
export type LineItemReconciliation = {
  expectedAmount: number | null
  billedAmount: number | null
  difference: number | null
  direction: "over" | "under" | "match" | null
}

/** The matched rate-card line ("From Quotation"). Null unless service-matched. */
export type LineItemFromQuotation = {
  title: string
  canonicalName: string
  tierSlug: string | null
  tier: string | null
  pricingContext: string | null
  attributes: Record<string, string | number | null>
}

/** The formula breakdown behind an expected amount. Null before matching. */
export type LineItemHowDetermined = {
  formula: string | null
  symbols: Record<string, number | null> | null
  expectedAmount: number | null
  billedAmount: number | null
  difference: number | null
}

/** The match model's per-field rationale for a line's matchKind. */
export type LineItemReasoning = {
  kind: string
  canonical: string
  tier: string
  references: string
}

/**
 * Local mirror of LineItemDto (packages/dtos/src/transactions/line-item.dto.ts). All
 * match-derived fields (status, matchKind, reconciliation's amounts, fromQuotation,
 * howDetermined, narrative, matchReasoning) are null until match-line-items runs.
 */
export type LineItem = {
  id: string
  description: string
  invoiceRef: string
  sectionLabel: string
  attributes: Record<string, string | number | null>
  sourceText: string
  foundAt: string | null
  status: LineItemStatus | null
  /** The status this line was accepted from (audit trail). Null unless status is "accepted". */
  acceptedFrom: LineItemStatus | null
  matchKind: LineItemMatchKind | null
  reconciliation: LineItemReconciliation
  fromQuotation: LineItemFromQuotation | null
  howDetermined: LineItemHowDetermined | null
  narrative: string | null
  matchReasoning: LineItemReasoning | null
  reviewNote: string | null
  guidance: string | null
  references: string[]
  taxable: boolean
  taxPercentage: number
}

/** Result of POST /transaction/documents/:id/extract-line-items — commits immediately. */
export type ExtractLineItemsResult = {
  documentId: string
  status: DocumentStatus
  fileName: string
  attributeSet: unknown
  lineItems: LineItem[]
}

/**
 * Result of POST /transaction/documents/:id/validate. Always 200; rejection is
 * status-field-driven, not a 400 — narrower than DocumentStatus since "rejected" is a
 * real transient value here even though it never reaches GET /transaction/documents.
 */
export type ValidateResult = {
  id: string
  status: "validated" | "rejected"
  warnings: string[]
  metadata: unknown
  rejectReason?: string
}

/** Result of POST /transaction/documents/:id/match-line-items — 201 (synchronous) case. */
export type MatchLineItemsResult = {
  documentId: string
  serviceMatchCount: number
  siblingRefCount: number
  unmatchedCount: number
}

/** Result of POST /transaction/documents/:id/match-line-items — 202 (queued/async) case. */
export type MatchQueued = {
  documentId: string
  status: "matching"
}

/** Result of GET /transaction/documents/:id/line-items. */
export type TransactionLineItemsResult = {
  documentId: string
  lineItems: LineItem[]
}

/**
 * Result of GET /transaction/documents/:id/match-status — the poll target after
 * starting background matching. matching = in flight; matched = done (fetch line
 * items); committed = not matching / reverted on failure.
 */
export type MatchStatusResult = {
  documentId: string
  status: DocumentStatus
}
