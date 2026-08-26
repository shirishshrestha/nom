import { toast } from "@nom/ui/components/sonner"
import {
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"
import type {
  CommitAllResult,
  ContentChunk,
  LatestUncommittedResult,
  ReviewStatusResult,
  SaveServiceItem,
  UncommittedResult,
  ValidateResult,
} from "@/features/quotations/types"
import { vendorQuotationsBaseKey } from "@/features/quotations/services/quotations"
import { api } from "@/lib/api"
import { getErrorMessage } from "@/lib/errors"

const uncommittedKey = (vendorId: string) =>
  ["source", "uncommitted", vendorId] as const

/** API wraps payloads in { success, data, message, status } — unwrap to data. */
async function getUncommitted(vendorId: string) {
  const res = await api.get<{ data: UncommittedResult }>(
    "/source/uncommitted",
    { params: { vendorId } }
  )
  return res.data.data
}

export const uncommittedQuery = (vendorId: string) =>
  queryOptions({
    queryKey: uncommittedKey(vendorId),
    queryFn: () => getUncommitted(vendorId),
  })

/**
 * Most-recently-touched uncommitted doc org-wide — drives the "previous
 * quotation incomplete" banner on the dashboard + add page.
 */
const latestUncommittedKey = ["source", "uncommitted", "latest"] as const

async function getLatestUncommitted() {
  const res = await api.get<{ data: LatestUncommittedResult }>(
    "/source/uncommitted/latest"
  )
  return res.data.data
}

export const latestUncommittedQuery = queryOptions({
  queryKey: latestUncommittedKey,
  queryFn: getLatestUncommitted,
})

/** On-demand source chunk behind a service's "View source" panel. Immutable → cached. */
const contentChunkKey = (contentId: string) =>
  ["source", "content", contentId] as const

async function getContentChunk(contentId: string) {
  const res = await api.get<{ data: ContentChunk }>(
    `/source/content/${contentId}`
  )
  return res.data.data
}

export const contentChunkQuery = (contentId: string) =>
  queryOptions({
    queryKey: contentChunkKey(contentId),
    queryFn: () => getContentChunk(contentId),
  })

function discardVendor(vendorId: string) {
  return api.post("/source/discard", { vendorId })
}

export function useDiscardVendorMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: discardVendor,
    onSuccess: (_res, vendorId) => {
      qc.invalidateQueries({ queryKey: latestUncommittedKey })
      qc.invalidateQueries({ queryKey: uncommittedKey(vendorId) })
    },
  })
}

/**
 * extracted → validated (financial gate + vendor match). Always 200: a
 * non-quotation document comes back as status "rejected" with a
 * rejectReason, not a 400 — the add-form reads status to gate before review.
 */
async function validateDocument(documentId: string) {
  const res = await api.post<{ data: ValidateResult }>(
    `/source/documents/${documentId}/validate`
  )
  return res.data.data
}

export function useValidateDocumentMutation(vendorId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: validateDocument,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: uncommittedKey(vendorId) }),
  })
}

/** Advancer step: validated → staged (extract priced service lines). Re-runnable. */
function extractServices(documentId: string) {
  return api.post(`/source/documents/${documentId}/extract-services`)
}

export function useExtractServicesMutation(vendorId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: extractServices,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: uncommittedKey(vendorId) }),
  })
}

/**
 * Review nav: mark a staged doc `ready_to_commit`, persisting the current edits
 * as a SAVE snapshot in the same call. No graph write — the actual commit is
 * deferred to `commit-all`.
 */
async function markReady(vars: {
  documentId: string
  services: SaveServiceItem[]
  deletedServiceIds: string[]
}) {
  const res = await api.post<{ data: ReviewStatusResult }>(
    `/source/documents/${vars.documentId}/mark-ready`,
    { services: vars.services, deletedServiceIds: vars.deletedServiceIds }
  )
  return res.data.data
}

export function useMarkReadyMutation(vendorId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: markReady,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: uncommittedKey(vendorId) }),
    onError: (error) =>
      toast.error(getErrorMessage(error, "Failed to mark file ready")),
  })
}

/** Revert a `ready_to_commit` doc back to `staged` so it's editable again. */
async function unmarkReady(documentId: string) {
  const res = await api.post<{ data: ReviewStatusResult }>(
    `/source/documents/${documentId}/unmark-ready`
  )
  return res.data.data
}

export function useUnmarkReadyMutation(vendorId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: unmarkReady,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: uncommittedKey(vendorId) }),
    onError: (error) =>
      toast.error(getErrorMessage(error, "Failed to reopen file")),
  })
}

/** Finalize: commit every reviewed (ready_to_commit) staged row for the vendor. */
async function commitAll(vars: { vendorId: string; stagedIds: string[] }) {
  const res = await api.post<{ data: CommitAllResult }>(
    "/source/commit-all",
    vars
  )
  return res.data.data
}

export function useCommitAllMutation(vendorId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: commitAll,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: uncommittedKey(vendorId) })
      qc.invalidateQueries({ queryKey: latestUncommittedKey })
      qc.invalidateQueries({ queryKey: vendorQuotationsBaseKey(vendorId) })
    },
    onError: (error) =>
      toast.error(getErrorMessage(error, "Failed to complete review")),
  })
}
