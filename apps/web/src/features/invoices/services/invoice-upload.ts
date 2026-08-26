import { useMutation, useQueryClient } from "@tanstack/react-query"
import { transactionDocumentsBaseKey } from "@/features/invoices/services/invoices"
import type {
  ExtractLineItemsResult,
  ValidateResult,
} from "@/features/invoices/types"
import { api } from "@/lib/api"

/**
 * extracted → validated (financial gate + vendor match). Transaction-specific path,
 * unlike quotations' /source/documents/:id/validate. Always 200; rejection is
 * status-field-driven (see ValidateResult), not a 400.
 */
async function validateDocument(documentId: string) {
  const res = await api.post<{ data: ValidateResult }>(
    `/transaction/documents/${documentId}/validate`
  )
  return res.data.data
}

export function useValidateDocumentMutation() {
  return useMutation({ mutationFn: validateDocument })
}

/**
 * validated → committed. Extract-line-items commits immediately — no staging step,
 * unlike quotations' extract-services (which just stages for review).
 */
async function extractLineItems(documentId: string) {
  const res = await api.post<{ data: ExtractLineItemsResult }>(
    `/transaction/documents/${documentId}/extract-line-items`
  )
  return res.data.data
}

export function useExtractLineItemsMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: extractLineItems,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: transactionDocumentsBaseKey }),
  })
}
