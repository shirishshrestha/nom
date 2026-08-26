import { Button } from "@nom/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nom/ui/components/dialog"

export function ConfirmDiscardUploadDialog({
  open,
  onOpenChange,
  onConfirm,
  isPending,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  isPending: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Are you sure you want to continue?</DialogTitle>
          <DialogDescription>
            You have an incomplete quotation in progress. Starting a new upload
            will permanently delete it. Are you sure you want to continue?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={isPending}>
            Discard & Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
