import { describe, expect, it } from "vitest"
import { setPendingFiles, takePendingFiles } from "@/shared/lib/pending-upload"

const file = (name: string) =>
  new File(["x"], name, { type: "application/pdf" })

describe("pending-upload", () => {
  it("hands off the files that were set", () => {
    const files = [file("a.pdf"), file("b.pdf")]
    setPendingFiles(files)
    expect(takePendingFiles()).toEqual(files)
  })

  it("empties on take, so a remount can't re-append stale files", () => {
    setPendingFiles([file("a.pdf")])
    takePendingFiles()
    expect(takePendingFiles()).toEqual([])
  })

  it("returns empty when nothing was set (direct navigation)", () => {
    expect(takePendingFiles()).toEqual([])
  })

  it("replaces rather than accumulates across handoffs", () => {
    setPendingFiles([file("a.pdf")])
    setPendingFiles([file("b.pdf")])
    expect(takePendingFiles().map((f) => f.name)).toEqual(["b.pdf"])
  })
})
