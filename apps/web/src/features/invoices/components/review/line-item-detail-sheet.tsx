import { Button } from "@nom/ui/components/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@nom/ui/components/collapsible"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetTitle,
} from "@nom/ui/components/sheet"
import { Textarea } from "@nom/ui/components/textarea"
import { cn } from "@nom/ui/lib/utils"
import { ArrowUpFromDot, ChevronDown, Loader2, X } from "lucide-react"
import { type ReactNode, useState } from "react"
import { useInvoiceReview } from "@/features/invoices/components/review/invoice-review-context"
import { useLineItemSelection } from "@/features/invoices/components/review/line-item-selection-context"
import { StatusBadge } from "@/features/invoices/components/review/status-badge"
import { formatAmount } from "@/features/invoices/lib/format-amount"
import { displayStatus } from "@/features/invoices/lib/line-item-status"
import type { LineItem } from "@/features/invoices/types"
import { HugeiconsIcon } from "@hugeicons/react"
import { GreaterThanIcon, LessThanIcon } from "@hugeicons/core-free-icons"

/** snake_case or camelCase key → Title Case label
 *  ("sum_insured" / "sumInsured" → "Sum Insured"). */
function formatKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/** `Record<string, number | null>` value → faithful string; no forced 2-decimals
 *  since these range from insured values (350,000) to rates (0.04). */
function formatSymbol(value: number | null): string {
  if (value == null) return "—"
  return value.toLocaleString(undefined, { maximumFractionDigits: 5 })
}

function differencePhrase(
  direction: LineItem["reconciliation"]["direction"],
  amount: number
): ReactNode {
  const value = (
    <span className="font-medium">
      {formatAmount(Math.abs(amount), undefined)}
    </span>
  )
  if (direction === "over") return <>Overcharged {value}</>
  if (direction === "under") return <>Undercharged {value}</>
  return <>Possible shortfall {value}</>
}

/** One collapsible section — chevron points down when open, up when closed
 *  (reverse of shadcn's default). Used for all four sheet sections. */
function SheetSection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <Collapsible defaultOpen>
      <CollapsibleTrigger className="group flex w-full items-center justify-between px-6 pb-1.5 text-left text-sm font-medium text-gray-800">
        {title}
        <ChevronDown className="size-4 text-gray-950 transition-transform group-data-[state=closed]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-6">{children}</CollapsibleContent>
    </Collapsible>
  )
}

export function LineItemDetailSheet() {
  const { selected, close } = useLineItemSelection()
  return (
    <Sheet
      open={selected !== null}
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <SheetContent
        showCloseButton={false}
        className="gap-0 rounded-l-lg p-0 transition-[width] data-[side=right]:w-[calc(100%-54px)] data-[side=right]:border-l-0 data-[side=right]:sm:max-w-none data-[side=right]:lg:max-w-[50%] data-[side=right]:xl:max-w-150"
      >
        {selected && (
          <LineItemDetailBody key={selected.id} lineItem={selected} />
        )}
      </SheetContent>
    </Sheet>
  )
}

/** Keyed by line-item id so switching items via prev/next remounts with fresh,
 *  uncontrolled note draft state. */
function LineItemDetailBody({ lineItem }: { lineItem: LineItem }) {
  const {
    hasPrev,
    hasNext,
    prev,
    next,
    saveGuidance,
    isSavingNote,
    accept,
    isAccepting,
  } = useLineItemSelection()
  const { activeDoc } = useInvoiceReview()
  const [note, setNote] = useState(lineItem.guidance ?? "")

  const status = displayStatus(lineItem.status, activeDoc?.isMatching ?? false)

  const { reconciliation, fromQuotation, howDetermined } = lineItem
  const rawAmount = lineItem.attributes.amount
  const amount =
    reconciliation.billedAmount ??
    (typeof rawAmount === "number" ? rawAmount : undefined)

  const showRecon =
    reconciliation.expectedAmount != null &&
    reconciliation.billedAmount != null &&
    reconciliation.difference != null

  /** Accepting settles the verdict, not the numbers — `reconciliation.direction` stays
   *  "under"/"over" forever, so the alert tone has to key off status. */
  const isFlagged = lineItem.status === "mismatch"
  const symbolHighlight =
    lineItem.status === "needs_review" ? "bg-orange-100" : undefined
  const amountHighlight = isFlagged ? "bg-red-100" : undefined

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-col gap-2.5 px-6 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs text-gray-600">
              Invoice {lineItem.invoiceRef}
            </p>
            <SheetTitle className="text-lg font-semibold text-gray-950">
              {lineItem.description}
            </SheetTitle>
          </div>
          <div className="flex h-full shrink-0 items-center gap-3">
            <div className="flex items-center gap-1.5">
              <Button
                variant="secondary"
                size="icon-sm"
                onClick={prev}
                disabled={!hasPrev}
                aria-label="Previous line item"
                className="rounded-full bg-gray-600"
              >
                <HugeiconsIcon icon={LessThanIcon} size={16} />
              </Button>
              <Button
                variant="secondary"
                size="icon-sm"
                onClick={next}
                disabled={!hasNext}
                aria-label="Next line item"
                className="rounded-full bg-gray-600 p-1"
              >
                <HugeiconsIcon icon={GreaterThanIcon} size={16} />
              </Button>
            </div>
            <div className="w-px text-sm leading-5 font-medium text-foreground">
              |
            </div>
            <SheetClose asChild>
              <X className="size-4 cursor-pointer text-foreground opacity-70" />
            </SheetClose>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-lg font-semibold text-foreground">
            {formatAmount(amount, undefined)}
          </span>
          <StatusBadge status={status} />
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
        {showRecon && (
          <div className="px-6">
            <div className="grid grid-cols-3 gap-4 border-y border-gray-300 py-1 text-center">
              <ReconCell
                label="Expected"
                value={reconciliation.expectedAmount}
              />
              <ReconCell
                label="Charged"
                value={reconciliation.billedAmount}
                direction={reconciliation.direction}
                muted={!isFlagged}
              />
              <ReconCell
                label="Difference"
                value={
                  reconciliation.difference != null
                    ? Math.abs(reconciliation.difference)
                    : null
                }
                direction={reconciliation.direction}
                muted={!isFlagged}
              />
            </div>
          </div>
        )}

        {fromQuotation && (
          <SheetSection title="From Quotation">
            <div className="space-y-3 rounded-sm border-b border-gray-100 bg-gray-50 px-5 py-2.5">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-gray-950">
                  {fromQuotation.title}
                </p>
              </div>
              <dl className="flex flex-col gap-1">
                {Object.entries(fromQuotation.attributes)
                  .filter(([key]) => key !== "serviceId" && key !== "tenantId")
                  .map(([key, value]) => (
                    <div
                      key={key}
                      className="flex items-baseline justify-between gap-4"
                    >
                      <dt className="text-sm font-medium text-gray-700">
                        {formatKey(key)}
                      </dt>
                      <dd className="text-end font-mono text-sm text-foreground">
                        {value ?? "—"}
                      </dd>
                    </div>
                  ))}
              </dl>
              {fromQuotation.pricingContext && (
                <p className="text-sm text-muted-foreground">
                  {fromQuotation.pricingContext}
                </p>
              )}
            </div>
          </SheetSection>
        )}

        {howDetermined && (
          <SheetSection title="How the result was determined">
            <div className="overflow-hidden rounded-md border border-gray-300 px-3 py-1.5">
              {Object.entries(howDetermined.symbols ?? {}).map(
                ([key, value]) => (
                  <DeterminedRow
                    key={key}
                    label={formatKey(key)}
                    value={formatSymbol(value)}
                    highlight={symbolHighlight}
                  />
                )
              )}
              {howDetermined.expectedAmount != null && (
                <DeterminedRow
                  label="Expected Amount"
                  value={formatAmount(howDetermined.expectedAmount, undefined)}
                  highlight={amountHighlight}
                />
              )}
              {howDetermined.billedAmount != null && (
                <DeterminedRow
                  label="Invoice Amount"
                  value={formatAmount(howDetermined.billedAmount, undefined)}
                  highlight={amountHighlight}
                />
              )}
              {howDetermined.difference != null && (
                <DeterminedRow
                  label="Difference"
                  value={differencePhrase(
                    reconciliation.direction,
                    howDetermined.difference
                  )}
                />
              )}
            </div>
          </SheetSection>
        )}

        {lineItem.narrative && (
          <SheetSection title="Why the AI reached this conclusion?">
            <p className="text-sm text-gray-600">{lineItem.narrative}</p>
          </SheetSection>
        )}

        <SheetSection title="Add a guidance">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Enter guidance for the system"
            rows={3}
          />
          <div className="mt-2 flex justify-end">
            <Button
              size="sm"
              disabled={
                isSavingNote || note.trim() === (lineItem.guidance ?? "").trim()
              }
              onClick={() => saveGuidance(note)}
            >
              {isSavingNote && <Loader2 className="size-4 animate-spin" />}
              {isSavingNote ? "Saving guidance" : "Save guidance"}
            </Button>
          </div>
        </SheetSection>
      </div>

      <SheetFooter className="flex-row justify-end gap-3 pt-0">
        <SheetClose asChild>
          <Button variant="outline">Close</Button>
        </SheetClose>
        <Button
          onClick={accept}
          disabled={
            isAccepting || status === "processing" || status === "accepted"
          }
        >
          {isAccepting && <Loader2 className="size-4 animate-spin" />}
          {status === "accepted" ? "Accepted" : "Accept"}
        </Button>
      </SheetFooter>
    </div>
  )
}

function ReconCell({
  label,
  value,
  direction,
  muted,
}: {
  label: string
  value: number | null
  direction?: LineItem["reconciliation"]["direction"]
  muted?: boolean
}) {
  const arrow = cn(
    "size-4",
    muted ? "text-muted-foreground" : "text-red-600",
    direction === "under" && "rotate-180"
  )
  return (
    <div className="space-y-2 pb-2">
      <p className="text-base text-foreground">{label}</p>
      <p className="mt-1 flex items-center justify-center gap-1 font-mono text-lg">
        {formatAmount(value ?? undefined, undefined)}
        {direction === "over" || direction === "under" ? (
          <ArrowUpFromDot className={arrow} />
        ) : null}
      </p>
    </div>
  )
}

function DeterminedRow({
  label,
  value,
  highlight,
}: {
  label: string
  value: ReactNode
  highlight?: string
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 border-b border-gray-300 px-2 py-1 last:border-b-0",
        highlight
      )}
    >
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <span
        className={cn(
          "font-mono text-sm text-foreground",
          highlight && "font-medium"
        )}
      >
        {value}
      </span>
    </div>
  )
}
