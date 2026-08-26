import { toast } from "@nom/ui/components/sonner"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { createContext, type ReactNode, use, useState } from "react"
import {
  type AdvanceState,
  useDocumentAdvancer,
} from "@/features/quotations/hooks/use-document-advancer"
import {
  buildServiceFormSchema,
  formValuesToSaveItem,
  type ServiceFormValues,
  serviceToFormValues,
} from "@/features/quotations/mappers/rules-review-mappers"
import {
  uncommittedQuery,
  useCommitAllMutation,
  useExtractServicesMutation,
  useMarkReadyMutation,
  useUnmarkReadyMutation,
} from "@/features/quotations/services/rules-review"
import type {
  AttributeSet,
  UncommittedDocument,
} from "@/features/quotations/types"

type RulesReviewValue = {
  vendorId: string
  attributeSet: AttributeSet | null
  documents: UncommittedDocument[]
  activeDoc: UncommittedDocument | undefined
  activeServiceId: string | null
  advanceState: Record<string, AdvanceState>
  drafts: Record<string, ServiceFormValues>
  invalidServiceIds: Set<string>
  serviceIssueCounts: Map<string, number>
  deletedServiceIds: Set<string>
  allReady: boolean
  isExtracting: boolean
  isReExtracting: boolean
  isMarkingReady: boolean
  isUnmarking: boolean
  isCommitting: boolean
  meta: {
    activeIndex: number
    total: number
    reviewedCount: number
    hasPrev: boolean
    hasNext: boolean
  }
  selectService: (serviceId: string | null) => void
  setDraft: (serviceId: string, values: ServiceFormValues) => void
  deleteService: (serviceId: string) => void
  markReadyNext: () => void
  unmarkPrev: () => void
  backToLastFile: () => void
  commitAll: () => void
  reExtract: (documentId: string) => void
  goToVendor: () => void
}

const RulesReviewContext = createContext<RulesReviewValue | null>(null)

export function useRulesReview(): RulesReviewValue {
  const ctx = use(RulesReviewContext)
  if (!ctx)
    throw new Error("useRulesReview must be used within <RulesReviewProvider>")
  return ctx
}

function sameValues(a: ServiceFormValues, b: ServiceFormValues): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) if (a[k] !== b[k]) return false
  return true
}

export function RulesReviewProvider({
  vendorId,
  children,
}: {
  vendorId: string
  children: ReactNode
}) {
  const navigate = useNavigate()
  const { data } = useQuery(uncommittedQuery(vendorId))
  const documents = data?.documents ?? []
  const attributeSet = data?.attributeSet ?? null

  const advanceState = useDocumentAdvancer(vendorId, documents)
  const extract = useExtractServicesMutation(vendorId)
  const markReady = useMarkReadyMutation(vendorId)
  const unmark = useUnmarkReadyMutation(vendorId)
  const commit = useCommitAllMutation(vendorId)

  const [selectedDocId, setSelectedDocId] = useState<string | null>(null)
  /**
   * Three-state: `undefined` = untouched (fall back to the first service),
   * `null` = the user explicitly closed everything. Collapsing to a plain
   * `string | null` would make Cards re-open row 01 whenever a card is closed.
   */
  const [activeServiceId, setActiveServiceId] = useState<string | null>()
  const [drafts, setDrafts] = useState<Record<string, ServiceFormValues>>({})
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set())

  /**
   * Derive (not store) the active doc/service so a refetch re-points selection
   * automatically. Defaults to array order — every non-staged status already
   * has a dedicated state in ReviewBody, so there's no reason to skip ahead.
   */
  const activeDoc =
    documents.find((d) => d.documentId === selectedDocId) ?? documents[0]
  const visibleServices =
    activeDoc?.services.filter((s) => !deletedIds.has(s.id)) ?? []
  const activeService =
    activeServiceId === undefined
      ? visibleServices[0]
      : visibleServices.find((s) => s.id === activeServiceId)
  const activeIndex = activeDoc
    ? documents.findIndex((d) => d.documentId === activeDoc.documentId)
    : -1

  const reviewedCount = documents.filter(
    (d) => d.reviewStatus === "ready_to_commit"
  ).length
  const allReady =
    documents.length > 0 &&
    documents.every((d) => d.reviewStatus === "ready_to_commit")

  const isExtracting =
    extract.isPending ||
    (!!activeDoc && advanceState[activeDoc.documentId] === "extracting")

  /** Invalid-field count per still-present service; a deleted row can't block Next. */
  const serviceIssueCounts = new Map<string, number>()
  if (attributeSet && activeDoc) {
    const schema = buildServiceFormSchema(attributeSet)
    for (const s of activeDoc.services) {
      if (deletedIds.has(s.id)) continue
      const values = drafts[s.id] ?? serviceToFormValues(s, attributeSet)
      const result = schema.safeParse(values)
      if (!result.success)
        serviceIssueCounts.set(s.id, result.error.issues.length)
    }
  }
  const invalidServiceIds = new Set(serviceIssueCounts.keys())

  function setDraft(serviceId: string, values: ServiceFormValues) {
    const original = activeDoc?.services.find((s) => s.id === serviceId)
    const baseline =
      original && attributeSet
        ? serviceToFormValues(original, attributeSet)
        : null
    setDrafts((prev) => {
      if (baseline && sameValues(values, baseline)) {
        if (!(serviceId in prev)) return prev
        const { [serviceId]: _drop, ...rest } = prev
        return rest
      }
      return { ...prev, [serviceId]: values }
    })
  }

  /** Drop a doc's pending edits (drafts + deletions) after persist / reopen. */
  function resetDocEdits(doc: UncommittedDocument) {
    setDrafts((prev) => {
      const next = { ...prev }
      for (const s of doc.services) delete next[s.id]
      return next
    })
    setDeletedIds((prev) => {
      if (!doc.services.some((s) => prev.has(s.id))) return prev
      const next = new Set(prev)
      for (const s of doc.services) next.delete(s.id)
      return next
    })
  }

  function deleteService(serviceId: string) {
    setDeletedIds((prev) => {
      const next = new Set(prev)
      next.add(serviceId)
      return next
    })
    if (activeService?.id === serviceId) setActiveServiceId(null)
  }

  /** Persist the active doc's edits + mark it ready, then advance to the next file. */
  function markReadyNext() {
    if (!activeDoc || !attributeSet || invalidServiceIds.size > 0) return
    const doc = activeDoc
    const services = doc.services.flatMap((s) =>
      deletedIds.has(s.id) || !drafts[s.id]
        ? []
        : [formValuesToSaveItem(s.id, drafts[s.id], attributeSet)]
    )
    const deletedServiceIds = doc.services.flatMap((s) =>
      deletedIds.has(s.id) ? [s.id] : []
    )
    markReady.mutate(
      { documentId: doc.documentId, services, deletedServiceIds },
      {
        onSuccess: () => {
          resetDocEdits(doc)
          const next = documents[activeIndex + 1]
          if (next) {
            setSelectedDocId(next.documentId)
            setActiveServiceId(undefined)
          }
        },
      }
    )
  }

  /**
   * Reopen a file for another pass: select it, drop its pending edits, and
   * unmark it (guarded so an already-`staged` target doesn't 400 on unmark).
   */
  function reopen(target: UncommittedDocument | undefined) {
    if (!target) return
    setSelectedDocId(target.documentId)
    setActiveServiceId(undefined)
    resetDocEdits(target)
    if (target.reviewStatus === "ready_to_commit")
      unmark.mutate(target.documentId)
  }

  const value: RulesReviewValue = {
    vendorId,
    attributeSet,
    documents,
    activeDoc,
    activeServiceId: activeService?.id ?? null,
    advanceState,
    drafts,
    invalidServiceIds,
    serviceIssueCounts,
    deletedServiceIds: deletedIds,
    allReady,
    isExtracting,
    isReExtracting: extract.isPending,
    isMarkingReady: markReady.isPending,
    isUnmarking: unmark.isPending,
    isCommitting: commit.isPending,
    meta: {
      activeIndex,
      total: documents.length,
      reviewedCount,
      hasPrev: activeIndex > 0,
      hasNext: activeIndex >= 0 && activeIndex < documents.length - 1,
    },
    selectService: setActiveServiceId,
    setDraft,
    deleteService,
    markReadyNext,
    unmarkPrev: () => reopen(documents[activeIndex - 1]),
    backToLastFile: () => reopen(documents[documents.length - 1]),
    commitAll: () => {
      const stagedIds = documents.flatMap((d) =>
        d.stagedId ? [d.stagedId] : []
      )
      if (stagedIds.length === 0) return
      commit.mutate(
        { vendorId, stagedIds },
        {
          onSuccess: (res) => {
            if (res.failed.length > 0) {
              toast.error(
                `${res.failed.length} file(s) couldn't be committed: ${res.failed
                  .map((f) => f.reason)
                  .join("; ")}`
              )
              return
            }
            navigate({ to: "/vendor/$vendorId", params: { vendorId } })
          },
        }
      )
    },
    reExtract: (documentId) => {
      extract.mutate(documentId)
    },
    goToVendor: () =>
      navigate({ to: "/vendor/$vendorId", params: { vendorId } }),
  }

  return <RulesReviewContext value={value}>{children}</RulesReviewContext>
}
