import { AxiosError } from "axios"
import { describe, expect, it } from "vitest"
import { getErrorMessage } from "@/lib/errors"

function axiosErrWith(data: unknown): AxiosError {
  const err = new AxiosError("Request failed")
  // biome-ignore lint/suspicious/noExplicitAny: minimal response stub for the test
  err.response = { data } as any
  return err
}

describe("getErrorMessage", () => {
  it("returns a NestJS string message", () => {
    const err = axiosErrWith({ statusCode: 404, message: "Vendor not found" })
    expect(getErrorMessage(err, "fallback")).toBe("Vendor not found")
  })

  it("joins a ValidationPipe array of string messages", () => {
    const err = axiosErrWith({
      statusCode: 400,
      message: ["vendorId must be a UUID", "ids should not be empty"],
    })
    expect(getErrorMessage(err, "fallback")).toBe(
      "vendorId must be a UUID, ids should not be empty"
    )
  })

  it("still handles FastAPI-style array of { msg } objects", () => {
    const err = axiosErrWith({ detail: [{ msg: "bad field" }] })
    expect(getErrorMessage(err, "fallback")).toBe("bad field")
  })

  it("falls back on an empty/unknown shape", () => {
    expect(getErrorMessage(axiosErrWith({}), "fallback")).toBe("fallback")
    expect(getErrorMessage(new Error(""), "fallback")).toBe("fallback")
  })

  it("uses a plain Error message when not an axios error", () => {
    expect(getErrorMessage(new Error("boom"), "fallback")).toBe("boom")
  })
})
