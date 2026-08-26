import { Button } from "@nom/ui/components/button"
import type { LineItem } from "@/features/invoices/types"
import { HugeiconsIcon } from "@hugeicons/react"
import { AlertCircle } from "@hugeicons/core-free-icons"

/**
 * has error/success variants today and this is a single call site; promote a shared
 * warning variant only if a second amber-banner consumer shows up.
 */
export function AttentionBanner({
  lineItems,
  onShowItems,
}: {
  lineItems: LineItem[]
  onShowItems: () => void
}) {
  const mismatchCount = lineItems.filter((l) => l.status === "mismatch").length
  const needsReviewCount = lineItems.filter(
    (l) => l.status === "needs_review"
  ).length
  const total = mismatchCount + needsReviewCount
  if (total === 0) return null

  const parts = [
    mismatchCount > 0
      ? `${mismatchCount} mismatch${mismatchCount === 1 ? "" : "es"}`
      : null,
    needsReviewCount > 0 ? `${needsReviewCount} to review` : null,
  ].filter(Boolean)

  return (
    <div className="flex items-center gap-4 border-b border-sidebar-border bg-amber-50 px-6 py-2 text-sm text-red-700">
      <HugeiconsIcon icon={AlertCircle} className="size-4 text-red-600" />
      <p className="flex-1">
        {total} item{total === 1 ? "" : "s"} need your attention in this
        document —{" "}
        {parts.map((part, i) => (
          <span key={part}>
            {i > 0 ? " and " : null}
            <span className="font-semibold">{part}</span>
          </span>
        ))}
      </p>
      <Button
        size="sm"
        className="bg-red-500 text-white hover:bg-red-600"
        onClick={onShowItems}
      >
        Show these items
      </Button>
    </div>
  )
}
