import { Button } from "@nom/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nom/ui/components/dialog"
import type { ReactNode } from "react"
import { PdfIcon } from "@/shared/components/icons"
import { formatFileSizeForDisplay } from "@/shared/lib/file"

export type InvalidFile = { name: string; size: number; reason?: string }

/**
 * `open`, `files`, and the `title`/`description` copy are all separate props
 * (not derived from files.length) so closing never has to clear the data —
 * Radix animates the dialog out over the same content instead of it flashing
 * empty mid-transition. Callers own the copy so the dialog serves any
 * "these files can't proceed" case (invalid document, mismatched type, …).
 */
export function InvalidFilesDialog({
  open,
  files,
  title,
  description,
  onOpenChange,
}: {
  open: boolean
  files: InvalidFile[]
  title: ReactNode
  description: ReactNode
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <ul className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {files.map((file) => (
            <li
              key={`${file.name}-${file.size}`}
              className="flex items-center gap-4 border-b border-border p-4"
            >
              <PdfIcon className="size-6 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium">{file.name}</p>
                  <span className="shrink-0 text-sm font-medium">
                    {formatFileSizeForDisplay(file.size)}
                  </span>
                </div>
                <p className="text-sm text-red-500">
                  {file.reason?.split("(")[0].trim() || "Invalid File"}
                </p>
              </div>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
