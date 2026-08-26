import { Badge } from "@nom/ui/components/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@nom/ui/components/dropdown-menu"
import dayjs from "dayjs"
import type { QuotationFile } from "@/features/quotations/types"
import { PdfIcon } from "@/shared/components/icons"

/**
 * Read-only: which files the vendor's quotations came from, not a filter. The
 * rows are plain markup rather than menu items so nothing looks clickable.
 *
 * ponytail: file name + upload date only — QuotationFileDto carries neither
 * `sizeBytes` nor the `documentId` a Re-extract action would need, and joining
 * /vendors/:id/files with the org-wide /source/documents costs two requests to
 * print one line. Add both to the DTO to build out the rest of the design.
 */
export function QuotationsFilesMenu({
  files,
  fileCount,
}: {
  files: QuotationFile[]
  fileCount: number
}) {
  if (fileCount === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Badge
          variant="outline"
          className="cursor-pointer rounded-lg bg-gray-200 text-muted-foreground shadow-xs"
        >
          {fileCount} file{fileCount > 1 ? "s" : ""}
        </Badge>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="scrollbar-hide max-h-60 w-92 overflow-y-auto shadow-sm"
        alignOffset={-4}
      >
        {files.map((file) => (
          <div
            key={file.fileId}
            className="flex items-center gap-2.5 px-2 py-1.5"
          >
            <PdfIcon className="size-4 shrink-0 text-foreground" />
            <div className="flex w-full min-w-0 flex-col">
              <span
                className="truncate text-sm font-medium text-foreground"
                title={file.fileName}
              >
                {file.fileName}
              </span>
              <span className="shrink-0 text-sm text-muted-foreground">
                {dayjs(file.uploadDate).format("DD MMM YYYY")}
              </span>
            </div>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
