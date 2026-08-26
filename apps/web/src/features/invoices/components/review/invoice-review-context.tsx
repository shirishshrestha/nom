import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  createContext,
  type ReactNode,
  use,
  useEffect,
  useRef,
  useState,
} from "react"
import { useDocumentMatcher } from "@/features/invoices/hooks/use-document-matcher"
import type { DocumentStatus } from "@/features/invoices/lib/invoice-status"
import {
  lineItemsKey,
  lineItemsQuery,
  matchStatusQuery,
} from "@/features/invoices/services/invoice-review"
import { invoiceDocumentsQuery } from "@/features/invoices/services/invoices"
import type { InvoiceDocument, LineItem } from "@/features/invoices/types"

type ReviewDocument = {
  documentId: string
  fileName: string
  lineItems: LineItem[]
  isMatching: boolean
  isLoadingLineItems: boolean
}

type InvoiceReviewValue = {
  vendorId: string
  documents: ReviewDocument[]
  activeDocId: string
  activeDoc: ReviewDocument | undefined
  selectDoc: (documentId: string) => void
}

const InvoiceReviewContext = createContext<InvoiceReviewValue | null>(null)

export function useInvoiceReview(): InvoiceReviewValue {
  const ctx = use(InvoiceReviewContext)
  if (!ctx)
    throw new Error(
      "useInvoiceReview must be used within <InvoiceReviewProvider>"
    )
  return ctx
}

/**
 * Documents in this batch come from the route's documentIds search param, filtered
 * out of invoiceDocumentsQuery (already loaded by the route loader) — not a
 * server-owned "uncommitted" listing, since transactions have no such endpoint. This
 * also means fileName/status stay correct across a page reload.
 */
export function InvoiceReviewProvider({
  vendorId,
  documentIds,
  children,
}: {
  vendorId: string
  documentIds: string[]
  children: ReactNode
}) {
  const qc = useQueryClient()
  const { data } = useQuery(invoiceDocumentsQuery({ vendorId }))
  const batch: InvoiceDocument[] = (data?.documents ?? []).filter((d) =>
    documentIds.includes(d.documentId)
  )

  /**
   * Each doc's `status` is overlaid with its live matchStatusQuery result (falling
   * back to the batch list's value until that query resolves) — the list is fetched
   * once by the route loader and never refetched, so it can't tell "still matching"
   * from "just finished" on its own.
   */
  const matchStatuses = useQueries({
    queries: batch.map((doc) => matchStatusQuery(doc.documentId)),
  })
  const liveDocs: InvoiceDocument[] = batch.map((doc, i) => ({
    ...doc,
    status: matchStatuses[i]?.data?.status ?? doc.status,
  }))

  useDocumentMatcher(liveDocs)

  const prevStatuses = useRef<Record<string, DocumentStatus>>({})
  const statusKey = liveDocs.map((d) => `${d.documentId}:${d.status}`).join(",")
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on statusKey, not liveDocs — liveDocs is a new array reference every render, which would otherwise rerun this on every unrelated render instead of only on a status change
  useEffect(() => {
    for (const doc of liveDocs) {
      const prev = prevStatuses.current[doc.documentId]
      if (prev === "matching" && doc.status === "matched")
        qc.invalidateQueries({ queryKey: lineItemsKey(doc.documentId) })
      prevStatuses.current[doc.documentId] = doc.status
    }
  }, [statusKey, qc])

  const lineItemResults = useQueries({
    queries: liveDocs.map((doc) => lineItemsQuery(doc.documentId)),
  })

  const [selectedDocId, setSelectedDocId] = useState<string | null>(null)

  const documents: ReviewDocument[] = liveDocs.map((doc, i) => ({
    documentId: doc.documentId,
    fileName: doc.fileName,
    lineItems: lineItemResults[i]?.data?.lineItems ?? [],
    isMatching: doc.status === "matching",
    isLoadingLineItems: lineItemResults[i]?.isLoading ?? false,
  }))

  const activeDoc =
    documents.find((d) => d.documentId === selectedDocId) ?? documents[0]

  const value: InvoiceReviewValue = {
    vendorId,
    documents,
    activeDocId: activeDoc?.documentId ?? "",
    activeDoc,
    selectDoc: setSelectedDocId,
  }

  return <InvoiceReviewContext value={value}>{children}</InvoiceReviewContext>
}
