import type { LineItemStatus } from "@/features/invoices/types"

/**
 * What a line's badge shows: its own review status, or — when it has none yet — whether
 * the document is still being matched. Resolving the two into one value here is what
 * stops `isMatching` having to be threaded down to every badge that draws one.
 */
export type DisplayStatus = LineItemStatus | "processing" | "pending"

export function displayStatus(
  status: LineItemStatus | null,
  isMatching: boolean
): DisplayStatus {
  return status ?? (isMatching ? "processing" : "pending")
}

/**
 * Label and badge tint per display status. The `satisfies` is the point: a new
 * LineItemStatus is a compile error here until its row is filled in.
 */
export const STATUS_CHIP = {
  match: { label: "Matched", className: "bg-gray-100 text-gray-600" },
  mismatch: { label: "Mismatch", className: "bg-red-100 text-red-600" },
  needs_review: { label: "Issue", className: "bg-orange-100 text-orange-600" },
  accepted: { label: "Accepted", className: "bg-green-100 text-green-700" },
  processing: { label: "Processing", className: "bg-blue-100 text-blue-500" },
  pending: { label: "Pending", className: "bg-gray-100 text-gray-500" },
} satisfies Record<DisplayStatus, { label: string; className: string }>

/** Whole-row background wash for the attention statuses; undefined for the rest. */
export function statusRowHighlight(
  status: LineItemStatus | null
): string | undefined {
  if (status === "mismatch") return "bg-red-50 hover:bg-red-50"
  if (status === "needs_review") return "bg-orange-50 hover:bg-orange-50"
  return undefined
}
