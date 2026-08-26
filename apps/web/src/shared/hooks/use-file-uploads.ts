import { useMutation } from "@tanstack/react-query"
import { useState } from "react"
import { api } from "@/lib/api"
import { isDuplicate } from "@/shared/lib/file"
import { uploadFileToS3 } from "@/shared/lib/file-upload"

/** Per-file upload state for an upload dropzone: uploading → completed | error. */
export type UploadItem = { id: string; file: File; progress: number } & (
  | { status: "uploading" }
  | { status: "completed"; fileId: string }
  | { status: "error"; error: string }
)

type PresignResult = { file: { id: string }; uploadUrl: string }

/** POST /files/presign → { file, uploadUrl }; storageKey/category are server-defaulted. */
async function presignFile(file: File, documentType: "source" | "transaction") {
  const res = await api.post<{ data: PresignResult }>("/files/presign", {
    name: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    documentType,
  })
  return res.data.data
}

/** Owns the presign → S3 → progress lifecycle for an upload dropzone. */
export function useFileUploads(documentType: "source" | "transaction") {
  const presign = useMutation({
    mutationFn: (file: File) => presignFile(file, documentType),
  })
  const [uploads, setUploads] = useState<UploadItem[]>([])

  function patchUpload(id: string, patch: Partial<UploadItem>) {
    setUploads((prev) =>
      prev.map((u) => (u.id === id ? ({ ...u, ...patch } as UploadItem) : u))
    )
  }

  async function startUpload(item: UploadItem) {
    try {
      const { file, uploadUrl } = await presign.mutateAsync(item.file)
      await uploadFileToS3(uploadUrl, item.file, {
        onProgress: (progress) => patchUpload(item.id, { progress }),
      })
      patchUpload(item.id, { status: "completed", fileId: file.id })
    } catch (err) {
      patchUpload(item.id, {
        status: "error",
        error: err instanceof Error ? err.message : "Upload failed",
      })
    }
  }

  function appendFiles(incoming: File[]) {
    const existing = uploads.map((u) => u.file)
    const fresh = incoming.filter((f) => !isDuplicate(f, existing))
    const items: UploadItem[] = fresh.map((file) => ({
      id: crypto.randomUUID(),
      file,
      progress: 0,
      status: "uploading",
    }))
    if (items.length === 0) return
    setUploads((prev) => [...prev, ...items])
    items.forEach(startUpload)
  }

  function removeFile(id: string) {
    setUploads((prev) => prev.filter((u) => u.id !== id))
  }

  return { uploads, appendFiles, removeFile }
}
