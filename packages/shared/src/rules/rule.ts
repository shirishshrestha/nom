// Vendor guardrails — natural-language instructions a customer sets per vendor to steer
// an LLM phase. Stored as :Rule nodes in Neo4j; the selected rules for a phase are
// appended to that phase's prompt. Distinct from a line item's reviewer `guidance`.
//
// The category is the phase the rule steers. It also implies the document type
// (service_* → source docs, line_item/matching → transaction docs), which is how a rule
// targets the right pipeline without a separate documentType field.
export const RULE_CATEGORIES = {
  SERVICE_EXTRACTION: 'service_extraction', // how services/rates are read out of source documents
  LINE_ITEM_EXTRACTION: 'line_item_extraction', // how billed line items are read out of invoices
  SERVICE_GROUPING: 'service_grouping', // how similar services are grouped as the same one
  MATCHING_RECONCILIATION: 'matching_and_reconciliation', // how billed lines are matched & reconciled
} as const;

export type RuleCategory =
  (typeof RULE_CATEGORIES)[keyof typeof RULE_CATEGORIES];
