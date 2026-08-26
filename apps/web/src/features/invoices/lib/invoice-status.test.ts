import { describe, expect, it } from "vitest"
import { statusLabel, statusTone } from "@/features/invoices/lib/invoice-status"

describe("statusTone / statusLabel", () => {
  it("maps committed and matched to success", () => {
    expect(statusTone("committed")).toBe("success")
    expect(statusTone("matched")).toBe("success")
    expect(statusLabel("committed")).toBe("Success")
    expect(statusLabel("matched")).toBe("Success")
  })

  it("maps every other in-flight status to pending", () => {
    for (const status of [
      "pending",
      "extracted",
      "validated",
      "processing",
    ] as const) {
      expect(statusTone(status)).toBe("pending")
      expect(statusLabel(status)).toBe("Pending")
    }
  })

  it("labels matching as Processing while still pending-toned", () => {
    expect(statusTone("matching")).toBe("pending")
    expect(statusLabel("matching")).toBe("Processing")
  })
})
