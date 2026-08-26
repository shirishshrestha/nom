import { Button } from "@nom/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nom/ui/components/dialog"
import { PdfIcon } from "@/shared/components/icons"
import { formatFileSizeForDisplay } from "@/shared/lib/file"

export type WarnedFile = { name: string; size: number; warnings: string[] }

/**
 * Surfaces ValidateResult.warnings (e.g. a vendor-name mismatch) before a batch
 * proceeds. `discardHint` completes "discard the flagged file(s) …" with what
 * Discard actually does for the caller's flow — invoices drop only the warned
 * files and extract the rest; quotations have no per-document discard endpoint,
 * so Discard there abandons the whole in-progress upload.
 */
export function ValidationWarningDialog({
  open,
  files,
  discardHint,
  onOpenChange,
  onContinue,
  onDiscard,
  isPending,
}: {
  open: boolean
  files: WarnedFile[]
  discardHint: string
  onOpenChange: (open: boolean) => void
  onContinue: () => void
  onDiscard: () => void
  isPending: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {files.length === 1
              ? "This file has a warning"
              : "Some files have warnings"}
          </DialogTitle>
          <DialogDescription>
            Review the warning for each file below. Continue anyway, or discard
            the flagged {files.length === 1 ? "file" : "files"} {discardHint}.
          </DialogDescription>
        </DialogHeader>
        <ul className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {files.map((file) => (
            <li
              key={`${file.name}-${file.size}`}
              className="flex items-start gap-4 border-b border-border p-4"
            >
              <PdfIcon className="mt-0.5 size-6 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium">{file.name}</p>
                  <span className="shrink-0 text-sm font-medium">
                    {formatFileSizeForDisplay(file.size)}
                  </span>
                </div>
                {file.warnings.map((w) => (
                  <p key={w} className="mt-1 text-sm text-amber-700">
                    {w}
                  </p>
                ))}
              </div>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={onDiscard} disabled={isPending}>
            Discard
          </Button>
          <Button onClick={onContinue} disabled={isPending}>
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
