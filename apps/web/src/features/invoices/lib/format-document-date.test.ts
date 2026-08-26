import { describe, expect, it } from "vitest"
import { formatDocumentDate } from "@/features/invoices/lib/format-document-date"

describe("formatDocumentDate", () => {
  it("splits an ISO timestamp into a long date and a 24h time", () => {
    expect(formatDocumentDate("2026-06-01T12:45:00")).toEqual({
      date: "01 June 2026",
      time: "12:45",
    })
  })

  it("returns a dash placeholder for null or an unparsable value", () => {
    expect(formatDocumentDate(null)).toEqual({ date: "—", time: "" })
    expect(formatDocumentDate("not a date")).toEqual({ date: "—", time: "" })
  })
})
