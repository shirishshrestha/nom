import { useEffect, useState } from "react"

export type FileRejectionReason = "type" | "maxFiles" | "maxSize"

export interface FileRejection {
  file: File
  reason: FileRejectionReason
}

export interface UseFileDropOptions {
  /** Called with the accepted files when a drop passes validation. */
  onDrop: (files: File[]) => void
  /** Called with files rejected due to type, maxFiles, or maxSize. */
  onReject?: (rejections: FileRejection[]) => void
  /** Accepted types — MIME (`application/pdf`), wildcard (`image/*`), or extension (`.pdf`). */
  accept?: string[]
  /** Maximum number of files allowed. */
  maxFiles?: number
  /** Maximum file size allowed, in bytes. */
  maxSize?: number
  /** Whether the drop zone is currently disabled. */
  disabled?: boolean
}

export interface UseFileDropReturn {
  isDragOver: boolean
  getDropZoneProps: () => {
    onDragEnter: (e: React.DragEvent) => void
    onDragOver: (e: React.DragEvent) => void
    onDragLeave: (e: React.DragEvent) => void
    onDrop: (e: React.DragEvent) => void
  }
}

type AcceptOptions = Pick<UseFileDropOptions, "accept" | "maxSize" | "maxFiles">

function isAcceptedFile(file: File, accept?: string[]): boolean {
  if (!accept || accept.length === 0) return true
  return accept.some((type) => {
    if (type.startsWith(".")) {
      return file.name.toLowerCase().endsWith(type.toLowerCase())
    }
    if (type.endsWith("/*")) {
      return file.type.startsWith(`${type.replace("/*", "")}/`)
    }
    return file.type === type
  })
}

/** Split files into accepted + rejected by type, size, then count. Shared by
 *  the drag path and click-to-browse so both enforce the same constraints. */
export function partitionFiles(
  files: File[],
  { accept, maxSize, maxFiles }: AcceptOptions
): { accepted: File[]; rejections: FileRejection[] } {
  const accepted: File[] = []
  const rejections: FileRejection[] = []
  for (const file of files) {
    if (!isAcceptedFile(file, accept)) rejections.push({ file, reason: "type" })
    else if (maxSize && file.size > maxSize)
      rejections.push({ file, reason: "maxSize" })
    else accepted.push(file)
  }
  if (maxFiles && accepted.length > maxFiles) {
    for (const file of accepted.splice(maxFiles)) {
      rejections.push({ file, reason: "maxFiles" })
    }
  }
  return { accepted, rejections }
}

export function useFileDrop({
  onDrop,
  onReject,
  accept,
  maxFiles,
  maxSize,
  disabled = false,
}: UseFileDropOptions): UseFileDropReturn {
  const [isDragOver, setIsDragOver] = useState(false)

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (disabled) return
    if (!Array.from(e.dataTransfer.types || []).includes("Files")) return
    setIsDragOver(true)
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (disabled) return
    if (!Array.from(e.dataTransfer.types || []).includes("Files")) return
    e.dataTransfer.dropEffect = "copy"
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (disabled) return
    /** Only hide when the drag has truly left the drop zone, not a child. */
    const currentTarget = e.currentTarget as HTMLElement
    const relatedTarget = e.relatedTarget as Node | null
    if (!currentTarget.contains(relatedTarget)) setIsDragOver(false)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (disabled) return
    setIsDragOver(false)

    const dataTransfer = e.dataTransfer
    if (!dataTransfer) return

    const dropped: File[] = []
    if (dataTransfer.items) {
      /** DataTransferItemList lets us filter out dropped directories. */
      for (const item of Array.from(dataTransfer.items)) {
        if (item.kind !== "file") continue
        if ("webkitGetAsEntry" in item) {
          const entry = item.webkitGetAsEntry?.()
          if (entry?.isDirectory) continue
        }
        const file = item.getAsFile()
        if (file) dropped.push(file)
      }
    } else {
      dropped.push(...Array.from(dataTransfer.files))
    }

    const { accepted, rejections } = partitionFiles(dropped, {
      accept,
      maxSize,
      maxFiles,
    })
    if (rejections.length > 0 && onReject) onReject(rejections)
    if (accepted.length > 0) onDrop(accepted)
  }

  useEffect(() => {
    if (disabled) setIsDragOver(false)
  }, [disabled])

  /** Catch cancelled drags (Esc, drop outside) and drags leaving the window. */
  useEffect(() => {
    const reset = () => setIsDragOver(false)
    const onWindowDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) reset()
    }
    document.addEventListener("dragend", reset)
    window.addEventListener("dragleave", onWindowDragLeave)
    return () => {
      document.removeEventListener("dragend", reset)
      window.removeEventListener("dragleave", onWindowDragLeave)
    }
  }, [])

  function getDropZoneProps() {
    return {
      onDragEnter: handleDragEnter,
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
    }
  }

  return { isDragOver, getDropZoneProps }
}
