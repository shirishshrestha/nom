import { toast } from "@nom/ui/components/sonner"
import {
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"
import type { InvoiceDocumentsResult } from "@/features/invoices/types"
import { api } from "@/lib/api"
import { getErrorMessage } from "@/lib/errors"

export const transactionDocumentsBaseKey = ["transaction", "documents"] as const

/**
 * `page`/`limit` are optional: the backend only paginates when a limit is
 * given (see documents.service.ts), so omitting both fetches the vendor's
 * full unpaged list — used by the review batch, which needs every document
 * in `documentIds` regardless of what page it'd land on in the table.
 */
export type InvoiceDocumentsParams = {
  vendorId?: string
  dateFrom?: string
  dateTo?: string
  page?: number
  limit?: number
}

/** API wraps payloads in { success, data, message, status } — unwrap to data. */
async function getTransactionDocuments(params: InvoiceDocumentsParams) {
  const res = await api.get<{ data: InvoiceDocumentsResult }>(
    "/transaction/documents",
    { params }
  )
  return res.data.data
}

export const invoiceDocumentsQuery = (params: InvoiceDocumentsParams) =>
  queryOptions({
    queryKey: [...transactionDocumentsBaseKey, params] as const,
    queryFn: () => getTransactionDocuments(params),
  })

async function downloadFile(fileId: string) {
  const res = await api.get<{ data: { url: string } }>(`/files/${fileId}/url`)
  window.open(res.data.data.url, "_blank")
}

export function useDownloadFileMutation() {
  return useMutation({
    mutationFn: downloadFile,
    onError: (error) =>
      toast.error(getErrorMessage(error, "Failed to download file")),
  })
}

/** Soft-delete (discard). The API rejects committed documents with a 400. */
function deleteDocument(documentId: string) {
  return api.delete(`/transaction/documents/${documentId}`)
}

/**
 * Invalidate rather than optimistically remove — the list is server-paginated,
 * so an optimistic splice would leave the page short by one until the next
 * fetch reconciles it anyway.
 */
export function useDeleteDocumentMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteDocument,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: transactionDocumentsBaseKey }),
    onError: (error) =>
      toast.error(getErrorMessage(error, "Failed to delete invoice")),
  })
}
