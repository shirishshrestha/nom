import { describe, expect, it } from "vitest"
import {
  categoryLabel,
  RULE_CATEGORIES,
} from "@/features/rules/lib/rule-category"

describe("rule-category", () => {
  it("has a non-empty label for every category", () => {
    for (const category of RULE_CATEGORIES) {
      expect(categoryLabel(category)).toBeTruthy()
    }
  })

  it("mirrors the four backend RULE_CATEGORIES", () => {
    expect([...RULE_CATEGORIES]).toEqual([
      "service_extraction",
      "line_item_extraction",
      "service_grouping",
      "matching_and_reconciliation",
    ])
  })
})
