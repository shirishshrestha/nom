import axios from "axios"

export function getErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as
      | { message?: unknown; detail?: unknown }
      | undefined
    // NestJS sends `message`; `detail` kept only as a defensive fallback.
    const raw = data?.message ?? data?.detail
    if (Array.isArray(raw)) {
      // ValidationPipe → array of strings; FastAPI-style → array of { msg }.
      const msgs = raw
        .map((d) => (typeof d === "string" ? d : d?.msg))
        .filter(Boolean)
      return msgs.join(", ") || fallback
    }
    if (typeof raw === "string") return raw || fallback
    return fallback
  }
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message) || fallback
  }
  return error instanceof Error ? error.message || fallback : fallback
}
