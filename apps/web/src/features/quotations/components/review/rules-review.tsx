import { Button } from "@nom/ui/components/button"
import { ButtonGroup } from "@nom/ui/components/button-group"
import { Input } from "@nom/ui/components/input"
import { toast } from "@nom/ui/components/sonner"
import { useNavigate } from "@tanstack/react-router"
import { AlertCircle, Loader2, Search } from "lucide-react"
import { useState } from "react"
import { DiscardReviewDialog } from "@/features/quotations/components/review/discard-review-dialog"
import { ReviewFileBar } from "@/features/quotations/components/review/review-file-bar"
import { ReviewFooter } from "@/features/quotations/components/review/review-footer"
import { CardsReview } from "@/features/quotations/components/review/cards-review"
import { ReviewComplete } from "@/features/quotations/components/review/review-complete"
import { extractedIsFinancial } from "@/features/quotations/lib/document-metadata"
import {
  RulesReviewProvider,
  useRulesReview,
} from "@/features/quotations/components/review/rules-review-context"
import { ServiceEditForm } from "@/features/quotations/components/review/service-edit-form"
import { ServicesList } from "@/features/quotations/components/review/services-list"
import { useDiscardVendorMutation } from "@/features/quotations/services/rules-review"
import { useDiscardReviewDialog } from "@/features/quotations/store/discard-review-dialog"
import type { ReviewService } from "@/features/quotations/types"
import { getErrorMessage } from "@/lib/errors"
import {
  PillTabsList,
  PillTabsTrigger,
  Tabs,
} from "@/shared/components/pill-tabs"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  LayoutTwoColumnIcon,
  LayoutTwoRowIcon,
} from "@hugeicons/core-free-icons"

type ViewMode = "split" | "cards"

const VIEW_MODE_STORAGE_KEY = "quotation-review-view"

export function RulesReview({ vendorId }: { vendorId: string }) {
  return (
    <RulesReviewProvider vendorId={vendorId}>
      <RulesReviewLayout />
    </RulesReviewProvider>
  )
}

function RulesReviewLayout() {
  const { allReady } = useRulesReview()
  const navigate = useNavigate()
  const { vendorId, close } = useDiscardReviewDialog()
  const discard = useDiscardVendorMutation()

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {allReady ? (
        <ReviewComplete />
      ) : (
        <>
          <ReviewFileBar />
          <ReviewBody />
        </>
      )}
      <DiscardReviewDialog
        open={vendorId != null}
        isPending={discard.isPending}
        onOpenChange={(open) => {
          if (!open) close()
        }}
        onCancel={close}
        onConfirm={() => {
          if (!vendorId) return
          discard.mutate(vendorId, {
            onSuccess: () => {
              close()
              toast.success("Quotation discarded")
              navigate({ to: "/vendor/$vendorId", params: { vendorId } })
            },
            onError: (error) =>
              toast.error(getErrorMessage(error, "Failed to discard")),
          })
        }}
      />
    </div>
  )
}

function ReviewBody() {
  const { activeDoc, advanceState, goToVendor, deletedServiceIds } =
    useRulesReview()
  const [viewMode, setViewMode] = useState<ViewMode>(
    () =>
      (localStorage.getItem(VIEW_MODE_STORAGE_KEY) as ViewMode | null) ??
      "split"
  )
  const [searchTerm, setSearchTerm] = useState("")

  function handleViewModeChange(mode: ViewMode) {
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode)
    setViewMode(mode)
  }

  if (!activeDoc)
    return (
      <CenteredState>
        <p className="text-sm text-muted-foreground">No files to review.</p>
        <Button variant="outline" size="sm" onClick={goToVendor}>
          Back to vendor
        </Button>
      </CenteredState>
    )

  if (advanceState[activeDoc.documentId] === "error")
    return (
      <CenteredState>
        <AlertCircle className="size-8 text-destructive" />
        <p className="text-sm font-medium">
          Couldn't extract rules from {activeDoc.fileName}
        </p>
        <p className="text-xs text-muted-foreground">
          Rule extraction failed for this file. Other files were not affected.
        </p>
      </CenteredState>
    )

  /**
   * In-flight only: the advancer stages "validated" docs (validated →
   * extracting → staged). "pending" is pre-extraction. Anything else
   * non-staged is terminal.
   */
  const isExtracting =
    advanceState[activeDoc.documentId] === "extracting" ||
    activeDoc.status === "pending" ||
    activeDoc.status === "validated"

  if (activeDoc.status !== "staged" && isExtracting)
    return (
      <CenteredState>
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Extracting rules from {activeDoc.fileName}…
        </p>
      </CenteredState>
    )

  // Terminal non-staged (extracted/rejected/discarded): no rules to review. A
  // non-financial document is the common case — say so instead of spinning.
  if (activeDoc.status !== "staged") {
    const isFinancial = extractedIsFinancial(activeDoc.metadata)
    return (
      <CenteredState>
        <AlertCircle className="size-8 text-muted-foreground" />
        <p className="text-sm font-medium">
          No rules to review in {activeDoc.fileName}
        </p>
        <p className="text-xs text-muted-foreground">
          {isFinancial === false
            ? "This file isn't a financial document, so no quotation rules were extracted."
            : "No quotation rules could be extracted from this file."}
        </p>
        <Button variant="outline" size="sm" onClick={goToVendor}>
          Back to vendor
        </Button>
      </CenteredState>
    )
  }

  const services = activeDoc.services.filter(
    (s) => !deletedServiceIds.has(s.id)
  )
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 pt-2">
      <QuotationsHeader
        count={services.length}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
      />
      {viewMode === "split" ? (
        <SplitReview services={services} searchTerm={searchTerm} />
      ) : (
        <CardsReview services={services} searchTerm={searchTerm} />
      )}
      <ReviewFooter />
    </div>
  )
}

function QuotationsHeader({
  count,
  viewMode,
  onViewModeChange,
  searchTerm,
  onSearchChange,
}: {
  count: number
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  searchTerm: string
  onSearchChange: (value: string) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-4 px-4">
      <div className="flex flex-1 items-center gap-2">
        <h2 className="text-base font-semibold">Quotations</h2>
        <span className="text-base font-semibold text-muted-foreground">
          {count}
        </span>
      </div>

      <Tabs
        value={viewMode}
        onValueChange={(v) => onViewModeChange(v as ViewMode)}
      >
        <PillTabsList>
          <PillTabsTrigger value="cards">
            Cards
            <HugeiconsIcon icon={LayoutTwoRowIcon} className="size-4" />
          </PillTabsTrigger>
          <PillTabsTrigger value="split">
            Split
            <HugeiconsIcon icon={LayoutTwoColumnIcon} className="size-4" />
          </PillTabsTrigger>
        </PillTabsList>
      </Tabs>

      <ButtonGroup className="shadow-xs border-border">
        <Input
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search…"
          className="w-56 text-sm border-r-border"
        />
        <Button
          variant="outline"
          aria-label="Search"
          className="bg-white px-2.5"
        >
          <Search className="size-4" />
        </Button>
      </ButtonGroup>
    </div>
  )
}

function SplitReview({
  services,
  searchTerm,
}: {
  services: ReviewService[]
  searchTerm: string
}) {
  return (
    <div className="flex min-h-0 flex-1 gap-3 px-4">
      <ServicesList services={services} searchTerm={searchTerm} />
      <ServiceEditForm />
    </div>
  )
}

function CenteredState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
      {children}
    </div>
  )
}
