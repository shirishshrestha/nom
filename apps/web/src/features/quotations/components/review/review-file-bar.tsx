import { FileEmpty02Icon, MagicWand05Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@nom/ui/components/button"
import { useRulesReview } from "@/features/quotations/components/review/rules-review-context"

export function ReviewFileBar() {
  const {
    documents,
    activeDoc,
    meta,
    isMarkingReady,
    isUnmarking,
    isExtracting,
    isReExtracting,
    reExtract,
  } = useRulesReview()

  if (documents.length === 0) return null

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b px-4 py-2">
      <div className="flex items-center gap-2.5 rounded-md border bg-white px-4 py-2 text-left text-sm">
        <HugeiconsIcon
          icon={FileEmpty02Icon}
          className="size-5 text-foreground"
        />
        <span className="flex flex-col items-start">
          <span className="text-sm font-semibold">
            {activeDoc?.fileName ?? "Select a file"}
          </span>
          <span className="text-xs text-foreground">
            File {meta.activeIndex + 1} of {meta.total}
          </span>
        </span>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            {documents.map((doc, index) => {
              if (doc.reviewStatus === "ready_to_commit")
                return (
                  <span
                    key={doc.documentId}
                    className="size-2.25 rounded-full bg-green-700"
                  />
                )
              if (index === meta.activeIndex)
                return (
                  <span
                    key={doc.documentId}
                    className="h-2.25 w-7.25 rounded-full bg-muted-foreground"
                  />
                )
              return (
                <span
                  key={doc.documentId}
                  className="size-2.25 rounded-full bg-black/30"
                />
              )
            })}
          </div>
          <span className="text-sm font-medium text-ring">
            {meta.reviewedCount} of {meta.total} reviewed
          </span>
        </div>

        <Button
          variant="outline"
          size="sm"
          disabled={!activeDoc || isExtracting || isMarkingReady || isUnmarking}
          onClick={() => activeDoc && reExtract(activeDoc.documentId)}
          className="gap-3 px-4"
        >
          <HugeiconsIcon icon={MagicWand05Icon} className="size-4" />
          {isReExtracting ? "Re-extracting…" : "Re-extract"}
        </Button>
      </div>
    </div>
  )
}
