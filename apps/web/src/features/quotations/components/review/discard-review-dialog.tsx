import { Button } from "@nom/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nom/ui/components/dialog"

/** Pure confirm — the mount site owns the discard mutation and its toasts. */
export function DiscardReviewDialog({
  open,
  isPending,
  onOpenChange,
  onConfirm,
  onCancel,
}: {
  open: boolean
  isPending: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Discard this quotation?</DialogTitle>
          <DialogDescription>
            This permanently deletes the in-progress quotation and all unsaved
            edits. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={isPending}
            onClick={onConfirm}
          >
            Discard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
