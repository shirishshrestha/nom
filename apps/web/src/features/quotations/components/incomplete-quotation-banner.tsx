import { Invoice02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@nom/ui/components/button"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { latestUncommittedQuery } from "@/features/quotations/services/rules-review"

/**
 * When `vendorId` is given (add-quotation page), the banner is contextual and
 * only shows if it matches the latest uncommitted quotation's vendor. Omit it
 * (dashboard) to always show. Checks `data.vendorId` too, not just `document`:
 * Review navigates to a route that requires a uuid vendorId.
 */
export function IncompleteQuotationBanner({ vendorId }: { vendorId?: string }) {
  const navigate = useNavigate()
  const { data } = useQuery(latestUncommittedQuery)

  if (!data?.document || !data.vendorId) return null
  if (vendorId !== undefined && data.vendorId !== vendorId) return null
  const reviewVendorId = data.vendorId

  return (
    <div className="flex items-center gap-3 self-stretch rounded-lg border bg-white px-4 py-2">
      <HugeiconsIcon
        icon={Invoice02Icon}
        className="size-4 shrink-0 text-foreground"
      />
      <p className="flex-1 text-sm font-medium">
        Your previous quotation is incomplete and has not been saved.
      </p>
      <Button
        variant="outline"
        onClick={() =>
          navigate({
            to: "/quotation/review",
            search: { vendorId: reviewVendorId },
          })
        }
        className="border-primary"
      >
        Review
      </Button>
    </div>
  )
}
