import { toast } from "@nom/ui/components/sonner"
import {
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"
import { transactionDocumentsBaseKey } from "@/features/invoices/services/invoices"
import type {
  LineItem,
  MatchLineItemsResult,
  MatchQueued,
  MatchStatusResult,
  TransactionLineItemsResult,
} from "@/features/invoices/types"
import { api } from "@/lib/api"
import { getErrorMessage } from "@/lib/errors"

export const lineItemsKey = (documentId: string) =>
  ["transaction", "documents", documentId, "line-items"] as const

async function getLineItems(documentId: string) {
  const res = await api.get<{ data: TransactionLineItemsResult }>(
    `/transaction/documents/${documentId}/line-items`
  )
  return res.data.data
}

/**
 * Plain fetch, no self-polling — completion is driven by matchStatusQuery
 * instead (see invoice-review-context.tsx), which invalidates this the moment
 * a document's match status flips to "matched". A queued (async) match job
 * resolves its POST immediately while the job keeps running server-side, so
 * this can't just poll off that promise settling.
 */
export const lineItemsQuery = (documentId: string) =>
  queryOptions({
    queryKey: lineItemsKey(documentId),
    queryFn: () => getLineItems(documentId),
  })

const matchStatusKey = (documentId: string) =>
  ["transaction", "documents", documentId, "match-status"] as const

async function getMatchStatus(documentId: string) {
  const res = await api.get<{ data: MatchStatusResult }>(
    `/transaction/documents/${documentId}/match-status`
  )
  return res.data.data
}

/**
 * Poll after starting background matching: matching = in flight, matched =
 * done, committed = not matching / reverted on failure. Stops the instant
 * status leaves "matching" — this is the authoritative per-document
 * completion signal, unlike the batch document list (fetched once, never
 * refetched during the review session).
 */
export const matchStatusQuery = (documentId: string) =>
  queryOptions({
    queryKey: matchStatusKey(documentId),
    queryFn: () => getMatchStatus(documentId),
    refetchInterval: (query) =>
      query.state.data?.status === "matching" ? 2000 : false,
  })

/** Reconcile a document's line items against the rate card. 201 sync or 202 queued. */
async function matchLineItems(documentId: string) {
  const res = await api.post<{ data: MatchLineItemsResult | MatchQueued }>(
    `/transaction/documents/${documentId}/match-line-items`
  )
  return res.data.data
}

export function useMatchLineItemsMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: matchLineItems,
    onSuccess: (_res, documentId) => {
      qc.invalidateQueries({ queryKey: lineItemsKey(documentId) })
      qc.invalidateQueries({ queryKey: matchStatusKey(documentId) })
    },
  })
}

/** Reviewer's persistent per-line correction, re-applied on every rerun. */
async function postGuidance(vars: {
  documentId: string
  lineItemId: string
  guidance: string
}) {
  const res = await api.post<{ data: LineItem }>(
    `/transaction/documents/${vars.documentId}/line-items/${vars.lineItemId}/guidance`,
    { guidance: vars.guidance }
  )
  return res.data.data
}

export function useGuidanceMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: postGuidance,
    onSuccess: (_res, vars) =>
      qc.invalidateQueries({ queryKey: lineItemsKey(vars.documentId) }),
    onError: (error) =>
      toast.error(getErrorMessage(error, "Failed to save guidance")),
  })
}

/**
 * Accept a flagged line's discrepancy as-is: status → accepted, prior status kept for
 * audit. The endpoint also takes an optional `reasonForAcceptance` it folds into the
 * audit log; nothing collects one yet, so this posts an empty body.
 */
async function acceptLineItem(vars: {
  documentId: string
  lineItemId: string
}) {
  const res = await api.post<{ data: LineItem }>(
    `/transaction/documents/${vars.documentId}/line-items/${vars.lineItemId}/accept`,
    {}
  )
  return res.data.data
}

export function useAcceptLineItemMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: acceptLineItem,
    onSuccess: (_res, vars) =>
      qc.invalidateQueries({ queryKey: lineItemsKey(vars.documentId) }),
    onError: (error) =>
      toast.error(getErrorMessage(error, "Failed to accept line item")),
  })
}

function markReviewed(documentId: string) {
  return api.post(`/transaction/documents/${documentId}/mark-reviewed`, {})
}

/**
 * Marks every document in the review batch reviewed — the review page exits to
 * the list on Complete, so a per-document call would strand the rest of the
 * batch at Pending. Partial failure rejects the whole thing: `reviewStatus` is
 * server-derived, and the invalidation on settle re-reads whatever actually
 * landed rather than assuming.
 */
export function useMarkReviewedMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (documentIds: string[]) =>
      Promise.all(documentIds.map(markReviewed)),
    onSettled: () =>
      qc.invalidateQueries({ queryKey: transactionDocumentsBaseKey }),
    onError: (error) =>
      toast.error(getErrorMessage(error, "Failed to complete review")),
  })
}
