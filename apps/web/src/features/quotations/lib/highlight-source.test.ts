import { describe, expect, it } from "vitest"
import { findSourceRange } from "@/features/quotations/lib/highlight-source"

describe("findSourceRange", () => {
  it("matches across line breaks and collapsed whitespace, mapping to the original span", () => {
    const text =
      "- The premium rate for shipments of SPICES \nand/or NUTS in containers is decreased from 0.12% to 0.10%."
    const needle =
      "The premium rate for shipments of SPICES and/or NUTS in containers is decreased from 0.12% to 0.10%."
    const range = findSourceRange(text, needle)
    if (!range) throw new Error("expected a match")
    const slice = text.slice(range.start, range.end)
    expect(slice.startsWith("The premium")).toBe(true)
    expect(slice.endsWith("0.10%.")).toBe(true)
    expect(slice).toContain("\n") // original line break preserved inside the span
    expect(text.slice(0, range.start)).toBe("- ") // leading "- " not highlighted
  })

  it("matches a clean single-line occurrence", () => {
    const text = "Base rate is 30.00 per permit for the first 5 line items."
    const range = findSourceRange(text, "30.00 per permit")
    expect(range).toEqual({ start: 13, end: 29 })
  })

  it("is case-insensitive", () => {
    const text = "Total COVERAGE amount"
    const range = findSourceRange(text, "coverage")
    if (!range) throw new Error("expected a match")
    expect(text.slice(range.start, range.end)).toBe("COVERAGE")
  })

  it("returns null when absent or empty", () => {
    expect(findSourceRange("some text", "missing phrase")).toBeNull()
    expect(findSourceRange("some text", "   ")).toBeNull()
  })
})
