import { Button } from "@nom/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nom/ui/components/dialog"

/** Pure confirm — the mount site owns the delete mutation and its toasts. */
export function DeleteRuleDialog({
  open,
  ruleTitle,
  isDeleting,
  onOpenChange,
  onConfirm,
  onCancel,
}: {
  open: boolean
  ruleTitle: string | undefined
  isDeleting: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete rule?</DialogTitle>
          <DialogDescription>
            This permanently deletes {ruleTitle}. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isDeleting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={isDeleting}
            onClick={onConfirm}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
