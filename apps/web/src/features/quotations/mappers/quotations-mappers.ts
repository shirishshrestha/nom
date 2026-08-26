import type {
  AttributeDef,
  CurrentService,
  CurrentServiceGroup,
  Quotation,
} from "@/features/quotations/types"

/**
 * Format one attribute value by its declared type; no per-set key knowledge.
 *
 * ponytail: numbers rendered plainly. Percent-vs-currency semantics (insurance
 * premium 0.10 = 0.10%) isn't recoverable from the metadata — it stays in the
 * Conditions column via remarks. Upgrade path: backend adds a format/role hint
 * to AttributeDef.
 */
export function formatAttrValue(
  value: string | number | null,
  type: AttributeDef["type"]
): string {
  if (value == null || value === "") return "—"
  return type === "number"
    ? Number(value).toLocaleString(undefined, { maximumFractionDigits: 20 })
    : String(value)
}

/**
 * Tiered titles carry the tier inline ("Local haulage - 20ft",
 * "Overtime rates: Weekdays", "Reefer distribution (1–5 cartons)") — strip
 * it for the merged row heading.
 */
export function groupTitle(first: CurrentService): string {
  if (first.tier == null) return first.title
  return first.title.split(/ - | \(|: /)[0].trim()
}

/** min/groupLabel aren't provided by /services yet. */
export function mapGroupedServicesToQuotations(
  groups: CurrentServiceGroup[]
): Quotation[] {
  return groups.map((group) => {
    const [first] = group.services
    const remarks =
      typeof first.attributes.remarks === "string"
        ? first.attributes.remarks
        : null
    return {
      id: first.id,
      title: groupTitle(first),
      code: group.canonicalName,
      conditions:
        first.pricingContext || remarks || group.canonicalDescription || "",
      tiers: group.services.map((s) => ({
        id: s.id,
        label: s.tier ?? undefined,
        attributes: s.attributes,
      })),
    }
  })
}
