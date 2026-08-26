import { describe, expect, it } from "vitest"
import { matchesStatus } from "@/features/invoices/lib/invoice-filters"
import type { InvoiceDocument } from "@/features/invoices/types"

function doc(over: Partial<InvoiceDocument> = {}): InvoiceDocument {
  return {
    documentId: "d1",
    fileId: "f1",
    fileName: "invoice.pdf",
    status: "committed",
    reviewStatus: "Pending",
    vendorId: null,
    effectiveFrom: "2026-06-15T00:00:00.000Z",
    createdAt: "2026-06-15T00:00:00.000Z",
    fileSizeBytes: 1024,
    metadata: {},
    ...over,
  }
}

describe("matchesStatus", () => {
  it("passes everything when filter is 'all'", () => {
    expect(matchesStatus(doc({ status: "pending" }), "all")).toBe(true)
  })

  it("matches success only for committed/matched", () => {
    expect(matchesStatus(doc({ status: "committed" }), "success")).toBe(true)
    expect(matchesStatus(doc({ status: "matched" }), "success")).toBe(true)
    expect(matchesStatus(doc({ status: "pending" }), "success")).toBe(false)
  })

  it("matches pending for everything else", () => {
    expect(matchesStatus(doc({ status: "processing" }), "pending")).toBe(true)
    expect(matchesStatus(doc({ status: "committed" }), "pending")).toBe(false)
  })
})
