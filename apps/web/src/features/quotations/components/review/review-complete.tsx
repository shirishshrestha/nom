import { Button } from "@nom/ui/components/button"
import { ChevronRight } from "lucide-react"
import { useRulesReview } from "@/features/quotations/components/review/rules-review-context"
import { HugeiconsIcon } from "@hugeicons/react"
import { Tick02Icon } from "@hugeicons/core-free-icons"

/**
 * Shown once every file is `ready_to_commit`. "Save & Complete" runs the batch
 * commit-all; "Back to <last file>" reopens the last file for another pass.
 */
export function ReviewComplete() {
  const { documents, backToLastFile, commitAll, isCommitting, isUnmarking } =
    useRulesReview()
  const totalServices = documents.reduce((n, d) => n + d.services.length, 0)
  const lastFileName = documents[documents.length - 1]?.fileName ?? "last file"

  return (
    <div className="flex min-h-0 flex-1 p-4">
      <div className="flex w-full flex-1 flex-col items-center justify-center gap-6 rounded-md bg-white text-center">
        <div className="flex flex-col items-center gap-2">
          <span className="flex size-16 items-center justify-center rounded-lg bg-green-200">
            <HugeiconsIcon
              icon={Tick02Icon}
              className="size-8 text-foreground"
            />
          </span>
          <div className="flex flex-col gap-2">
            {documents.map((doc) => (
              <p
                key={doc.documentId}
                className="text-lg font-semibold text-foreground"
              >
                {doc.fileName} saved
              </p>
            ))}
          </div>
          <p className="text-lg font-medium text-foreground">
            {totalServices} Quotations saved · Review Completed
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            disabled={isUnmarking || isCommitting}
            onClick={backToLastFile}
          >
            Back to {lastFileName}
          </Button>

          <Button disabled={isCommitting} onClick={commitAll}>
            <ChevronRight className="size-4" />
            {isCommitting ? "Saving…" : "Save & Complete"}
          </Button>
        </div>
      </div>
    </div>
  )
}
