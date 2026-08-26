import { Button } from "@nom/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nom/ui/components/dialog"
import type { ReviewService } from "@/features/quotations/types"

export function ConfirmDeleteServiceDialog({
  open,
  service,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  service: ReviewService | null
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this quotation line?</DialogTitle>
          <DialogDescription>
            “{service?.title}” will be removed from this review. The change is
            applied when you save the file. This can’t be undone from here.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
