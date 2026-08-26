import { statusTone } from "@/features/invoices/lib/invoice-status"
import type { InvoiceDocument } from "@/features/invoices/types"

export type StatusFilter = "all" | "success" | "pending"

/**
 * Client-side only: GET /transaction/documents takes one exact DocumentStatus,
 * not the success/pending tone groups this dropdown offers, so this narrows
 * the current (already server-paginated) page rather than the full result set.
 */
export function matchesStatus(
  doc: InvoiceDocument,
  filter: StatusFilter
): boolean {
  return filter === "all" || statusTone(doc.status) === filter
}
