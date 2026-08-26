/**
 * Local mirror of RULE_CATEGORIES (@nom/shared) — the pipeline phase a rule
 * steers. Same "local mirror" convention as `invoices/lib/invoice-status.ts`.
 * Order here is the order shown in the category select.
 */
export const RULE_CATEGORIES = [
  "service_extraction",
  "line_item_extraction",
  "service_grouping",
  "matching_and_reconciliation",
] as const

export type RuleCategory = (typeof RULE_CATEGORIES)[number]

const CATEGORY_LABELS: Record<RuleCategory, string> = {
  service_extraction: "Service Extraction",
  line_item_extraction: "Line Item Extraction",
  service_grouping: "Service Grouping",
  matching_and_reconciliation: "Matching & Reconciliation",
}

export function categoryLabel(category: RuleCategory): string {
  return CATEGORY_LABELS[category]
}
