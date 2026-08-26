import { cn } from "@nom/ui/lib/utils"
import { formatAttrValue } from "@/features/quotations/mappers/quotations-mappers"
import type { AttributeDef, QuotationTier } from "@/features/quotations/types"
import { TruncatedText } from "@/shared/components/truncated-text"

/** Stacks a group's tier labels once, aligned row-for-row with the value cells. */
export function TierCell({ tiers }: { tiers: QuotationTier[] }) {
  return (
    <div className="space-y-0.5">
      {tiers.map((tier) => (
        <TruncatedText
          key={tier.id}
          className="block max-w-40 text-sm font-medium text-gray-700"
        >
          {tier.label ?? "—"}
        </TruncatedText>
      ))}
    </div>
  )
}

/**
 * Renders one attribute across a group's tiers — one truncating line per tier,
 * aligned with the Tier column. Tier labels live in their own column, not here.
 */
export function AttributeCell({
  tiers,
  attr,
}: {
  tiers: QuotationTier[]
  attr: AttributeDef
}) {
  const valueClass = cn(
    attr.type === "number" && "font-mono text-foreground!",
    "block max-w-45 font-medium text-gray-700"
  )
  return (
    <div className="space-y-0.5">
      {tiers.map((tier) => (
        <TruncatedText key={tier.id} className={valueClass}>
          {formatAttrValue(tier.attributes[attr.key], attr.type)}
        </TruncatedText>
      ))}
    </div>
  )
}
