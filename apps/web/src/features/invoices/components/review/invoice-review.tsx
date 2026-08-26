import { useQuery } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { useState } from "react"
import { AttentionBanner } from "@/features/invoices/components/review/attention-banner"
import {
  InvoiceReviewProvider,
  useInvoiceReview,
} from "@/features/invoices/components/review/invoice-review-context"
import { LineItemDetailSheet } from "@/features/invoices/components/review/line-item-detail-sheet"
import { LineItemSelectionProvider } from "@/features/invoices/components/review/line-item-selection-context"
import { ReviewFooter } from "@/features/invoices/components/review/review-footer"
import { ReviewSidebar } from "@/features/invoices/components/review/review-sidebar"
import { ReviewTable } from "@/features/invoices/components/review/review-table"
import {
  type ReviewTab,
  ReviewTabs,
  reviewTabFilter,
} from "@/features/invoices/components/review/review-tabs"
import {
  ReviewToolbar,
  type SortOrder,
} from "@/features/invoices/components/review/review-toolbar"
import type { LineItem } from "@/features/invoices/types"
import { vendorsQuery } from "@/features/vendors/services/vendors"

export function InvoiceReview({
  vendorId,
  documentIds,
}: {
  vendorId: string
  documentIds: string[]
}) {
  return (
    <InvoiceReviewProvider vendorId={vendorId} documentIds={documentIds}>
      <InvoiceReviewLayout />
    </InvoiceReviewProvider>
  )
}

function InvoiceReviewLayout() {
  const { vendorId, activeDoc } = useInvoiceReview()
  const { data: vendors = [] } = useQuery(vendorsQuery)
  const vendorName = vendors.find((v) => v.id === vendorId)?.name

  const [tab, setTab] = useState<ReviewTab>("all")
  const [sortOrder, setSortOrder] = useState<SortOrder>("none")
  const [searchTerm, setSearchTerm] = useState("")

  if (!activeDoc) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        No documents to review.
      </div>
    )
  }

  const lineItems = filterAndSort(
    activeDoc.lineItems,
    tab,
    searchTerm,
    sortOrder
  )

  return (
    <LineItemSelectionProvider
      documentId={activeDoc.documentId}
      lineItems={lineItems}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <AttentionBanner
          lineItems={activeDoc.lineItems}
          onShowItems={() => setTab("needsAttention")}
        />
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <ReviewTabs
            lineItems={activeDoc.lineItems}
            tab={tab}
            onTabChange={setTab}
          />
          <ReviewToolbar
            sortOrder={sortOrder}
            onSortOrderChange={setSortOrder}
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
          />
        </div>
        <div className="flex min-h-0 flex-1 gap-3 px-4 pt-2 pb-6">
          <ReviewSidebar vendorName={vendorName} />
          <div className="flex min-h-0 flex-1 flex-col rounded-md border border-border">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {activeDoc.isLoadingLineItems ? (
                <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Loading line items…
                </div>
              ) : (
                <ReviewTable lineItems={lineItems} vendorName={vendorName} />
              )}
            </div>
            <ReviewFooter />
          </div>
        </div>
        <LineItemDetailSheet />
      </div>
    </LineItemSelectionProvider>
  )
}

function filterAndSort(
  lineItems: LineItem[],
  tab: ReviewTab,
  searchTerm: string,
  sortOrder: SortOrder
): LineItem[] {
  const tabFiltered = reviewTabFilter(lineItems, tab)
  const term = searchTerm.trim().toLowerCase()
  const searched = term
    ? tabFiltered.filter(
        (l) =>
          l.description.toLowerCase().includes(term) ||
          l.invoiceRef.toLowerCase().includes(term)
      )
    : tabFiltered
  if (sortOrder !== "alphabetical") return searched
  return searched.toSorted((a, b) => a.description.localeCompare(b.description))
}
