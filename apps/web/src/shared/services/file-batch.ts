import { useMutation } from "@tanstack/react-query"
import { api } from "@/lib/api"

export type FileExtractResult = {
  documentId: string
  fileId: string
  status: string
  metadata: unknown
}

/** Link confirmed files to a vendor — generic across source/transaction documents. */
function confirmMany(vars: { vendorId: string; ids: string[] }) {
  return api.post("/files/confirm-many", vars)
}

export function useConfirmManyMutation() {
  return useMutation({ mutationFn: confirmMany })
}

/** Create documents from confirmed files (status → extracted). Generic across document types. */
async function extractMetadata(fileIds: string[]) {
  const res = await api.post<{ data: FileExtractResult[] }>(
    "/files/extract-metadata",
    { fileIds }
  )
  return res.data.data
}

export function useExtractMetadataMutation() {
  return useMutation({ mutationFn: extractMetadata })
}
