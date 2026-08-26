import {
  PillTabsList,
  PillTabsTrigger,
  Tabs,
} from "@/shared/components/pill-tabs"
import type { LineItem } from "@/features/invoices/types"

export type ReviewTab = "all" | "needsAttention" | "matched"

export function reviewTabFilter(
  lineItems: LineItem[],
  tab: ReviewTab
): LineItem[] {
  if (tab === "all") return lineItems
  if (tab === "matched") return lineItems.filter((l) => l.status === "match")
  return lineItems.filter(
    (l) => l.status === "mismatch" || l.status === "needs_review"
  )
}

export function ReviewTabs({
  lineItems,
  tab,
  onTabChange,
}: {
  lineItems: LineItem[]
  tab: ReviewTab
  onTabChange: (tab: ReviewTab) => void
}) {
  const needsAttentionCount = reviewTabFilter(
    lineItems,
    "needsAttention"
  ).length
  const matchedCount = reviewTabFilter(lineItems, "matched").length

  return (
    <Tabs value={tab} onValueChange={(v) => onTabChange(v as ReviewTab)}>
      <PillTabsList>
        <PillTabsTrigger value="all">All {lineItems.length}</PillTabsTrigger>
        <PillTabsTrigger value="needsAttention">
          Needs Attention {needsAttentionCount}
        </PillTabsTrigger>
        <PillTabsTrigger value="matched">
          Matched {matchedCount}
        </PillTabsTrigger>
      </PillTabsList>
    </Tabs>
  )
}
