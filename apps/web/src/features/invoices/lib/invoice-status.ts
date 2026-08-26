/**
 * Local mirror of DocumentStatus (@nom/shared DOCUMENT_STATUSES), scoped to the
 * values a transaction document's lifecycle can actually reach — `staged` is a
 * source/quotation-only concept, and `rejected`/`discarded`/`superseded` never
 * reach GET /transaction/documents (excluded or soft-deleted server-side).
 */
export type DocumentStatus =
  | "pending"
  | "extracted"
  | "validated"
  | "processing"
  | "committed"
  | "matching"
  | "matched"

/**
 * Local mirror of ReviewStatus (@nom/shared REVIEW_STATUSES) — the reviewer-facing
 * status shown in the invoice list, derived server-side from the reviewCompleted flag.
 */
export type ReviewStatus = "Pending" | "Completed"

export type StatusTone = "success" | "pending"

/**
 * `committed`/`matched` mean the line items are in and reconciled; everything
 * else is still mid-pipeline. ponytail: only 2 tones, matching the design —
 * any status this union doesn't yet name (a future addition to
 * DOCUMENT_STATUSES) falls back to "pending" rather than throwing.
 */
export function statusTone(status: DocumentStatus): StatusTone {
  return status === "committed" || status === "matched" ? "success" : "pending"
}

/** `matching` reads as "Processing" — still `pending`-toned, just a clearer label. */
export function statusLabel(status: DocumentStatus): string {
  if (status === "matching") return "Processing"
  return statusTone(status) === "success" ? "Success" : "Pending"
}
