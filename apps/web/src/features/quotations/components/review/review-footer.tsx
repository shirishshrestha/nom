import { Button } from "@nom/ui/components/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@nom/ui/components/tooltip"
import { useRulesReview } from "@/features/quotations/components/review/rules-review-context"
import { useDiscardReviewDialog } from "@/features/quotations/store/discard-review-dialog"

export function ReviewFooter() {
  const {
    vendorId,
    isExtracting,
    isMarkingReady,
    isUnmarking,
    invalidServiceIds,
    meta,
    markReadyNext,
    unmarkPrev,
  } = useRulesReview()
  const openDiscard = useDiscardReviewDialog((s) => s.openFor)
  const hasInvalid = invalidServiceIds.size > 0
  const busy = isMarkingReady || isUnmarking || isExtracting

  return (
    <div className="flex w-full items-center justify-end border-t bg-white px-4 py-3">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => openDiscard(vendorId)}
        >
          Discard
        </Button>
        <div className="flex items-center shadow-xs">
          <Button
            variant="outline"
            disabled={!meta.hasPrev || busy}
            onClick={unmarkPrev}
            className="rounded-r-none"
          >
            Previous File
          </Button>
          {hasInvalid ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button disabled className="rounded-l-none">
                    {meta.hasNext ? "Next File" : "Finish Review"}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-60">
                Complete all required fields before continuing.
              </TooltipContent>
            </Tooltip>
          ) : (
            <Button
              disabled={busy}
              onClick={markReadyNext}
              className="rounded-l-none"
            >
              {isMarkingReady
                ? "Saving…"
                : meta.hasNext
                  ? "Next File"
                  : "Finish Review"}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
