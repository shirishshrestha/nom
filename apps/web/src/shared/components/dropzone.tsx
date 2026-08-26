import { FileUploadIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { toast } from "@nom/ui/components/sonner"
import { cn } from "@nom/ui/lib/utils"
import { type ReactNode, useRef } from "react"
import {
  type FileRejection,
  partitionFiles,
  useFileDrop,
} from "@/hooks/use-file-drop"
import { formatFileSizeForDisplay } from "@/shared/lib/file"

type DropzoneProps = {
  onFiles: (files: File[]) => void
  accept?: string[]
  maxSize?: number
  maxFiles?: number
  multiple?: boolean
  disabled?: boolean
  /** Overrides the inner caption line (e.g. show the selected filename). */
  label?: ReactNode
  /** Replaces the entire inner content (icon + caption) so callers compose their own. */
  children?: ReactNode
  /** Render a "Supported Format / Maximum size" caption below, derived from accept/maxSize. */
  showHints?: boolean
  className?: string
}

function rejectionMessage(
  rejections: FileRejection[],
  maxSize?: number
): string {
  const { reason, file } = rejections[0]
  if (reason === "type") return `${file.name}: unsupported file type`
  if (reason === "maxSize")
    return `${file.name} exceeds the ${maxSize ? formatFileSizeForDisplay(maxSize) : "size"} limit`
  return "Too many files selected"
}

/** Dashed drop area with drag highlight + click-to-browse. Owns only the drag
 *  interaction; callers render their own label/caption/file list around it. */
export function Dropzone({
  onFiles,
  accept,
  maxSize,
  maxFiles,
  multiple = false,
  disabled = false,
  label,
  children,
  showHints = false,
  className,
}: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  function reject(rejections: FileRejection[]) {
    toast.error(rejectionMessage(rejections, maxSize))
  }

  const { isDragOver, getDropZoneProps } = useFileDrop({
    onDrop: onFiles,
    onReject: reject,
    accept,
    maxSize,
    maxFiles,
    disabled,
  })

  function onBrowse(list: FileList | null) {
    const { accepted, rejections } = partitionFiles(Array.from(list ?? []), {
      accept,
      maxSize,
      maxFiles,
    })
    if (rejections.length > 0) reject(rejections)
    if (accepted.length > 0) onFiles(accepted)
  }

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: drop zone is a clickable div (opens file picker) */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard handled via the hidden file input */}
      <div
        {...getDropZoneProps()}
        onClick={() => !disabled && inputRef.current?.click()}
        data-disabled={disabled}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md px-3 py-6 text-center shadow-xs transition-colors data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-50",
          /** background-image dashes: only one active at a time, so swap rather than stack. */
          isDragOver
            ? "bg-slate-100 border-long-dashed-sky-600"
            : "border-long-dashed hover:border-long-dashed-sky-600",
          className
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept?.join(",")}
          multiple={multiple}
          className="sr-only"
          onChange={(e) => {
            onBrowse(e.target.files)
            e.target.value = ""
          }}
        />
        {children ?? (
          <>
            <HugeiconsIcon
              icon={FileUploadIcon}
              size={64}
              strokeWidth={1}
              className="text-foreground"
            />
            <p className="text-sm text-secondary-foreground">
              {label ?? (
                <>
                  Drag and Drop file here or{" "}
                  <span className="underline">Choose file</span>
                </>
              )}
            </p>
          </>
        )}
      </div>
      {showHints && (
        <div className="flex justify-between text-sm text-muted-foreground">
          {accept && accept.length > 0 && (
            <span>
              Supported Format:{" "}
              {accept.map((a) => a.split("/").pop()?.toUpperCase()).join(", ")}
            </span>
          )}
          {maxSize && (
            <span>Maximum size: {formatFileSizeForDisplay(maxSize)}</span>
          )}
        </div>
      )}
    </>
  )
}
