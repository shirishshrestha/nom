import { describe, expect, it } from "vitest"
import {
  extractedAttributeSet,
  extractedIsFinancial,
} from "@/features/quotations/lib/document-metadata"

describe("extractedAttributeSet", () => {
  it("reads a string attributeSet", () => {
    expect(extractedAttributeSet({ attributeSet: "insurance" })).toBe(
      "insurance"
    )
  })

  it("returns null for a non-string attributeSet", () => {
    expect(extractedAttributeSet({ attributeSet: 42 })).toBeNull()
    expect(extractedAttributeSet({ attributeSet: null })).toBeNull()
  })

  it("returns null when the key or object is absent", () => {
    expect(extractedAttributeSet({ other: "x" })).toBeNull()
    expect(extractedAttributeSet(null)).toBeNull()
    expect(extractedAttributeSet(undefined)).toBeNull()
    expect(extractedAttributeSet("insurance")).toBeNull()
  })
})

describe("extractedIsFinancial", () => {
  it("reads a boolean isFinancial (including false)", () => {
    expect(extractedIsFinancial({ isFinancial: true })).toBe(true)
    expect(extractedIsFinancial({ isFinancial: false })).toBe(false)
  })

  it("returns null for a non-boolean or missing flag", () => {
    expect(extractedIsFinancial({ isFinancial: "yes" })).toBeNull()
    expect(extractedIsFinancial({})).toBeNull()
    expect(extractedIsFinancial(null)).toBeNull()
  })
})
