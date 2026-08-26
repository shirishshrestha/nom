import { Button } from "@nom/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nom/ui/components/dialog"
import { Loader2 } from "lucide-react"

/** Pure confirm — the mount site owns the mark-reviewed mutation and its toasts. */
export function CompleteReviewDialog({
  open,
  fileNames,
  isPending,
  onOpenChange,
  onConfirm,
  onCancel,
}: {
  open: boolean
  fileNames: string[]
  isPending: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  const isBatch = fileNames.length > 1

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isBatch
              ? `Mark all ${fileNames.length} invoices reviewed?`
              : "Mark this invoice reviewed?"}
          </DialogTitle>
          <DialogDescription>
            This marks {isBatch ? "every file in this review" : fileNames[0]} as
            reviewed and returns to the list.
          </DialogDescription>
        </DialogHeader>
        {isBatch && (
          <ul className="max-h-40 overflow-y-auto rounded-md bg-muted px-4 py-3 text-sm text-muted-foreground">
            {fileNames.map((name) => (
              <li key={name} className="truncate">
                {name}
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isPending}>
            Cancel
          </Button>
          <Button disabled={isPending} onClick={onConfirm}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            Complete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
