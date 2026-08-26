import dayjs from "dayjs"

/**
 * `effectiveFrom` (ISO) → the split date/time shown per row — e.g.
 * "01 June 2026" + "12:45".
 */
export function formatDocumentDate(iso: string | null): {
  date: string
  time: string
} {
  if (!iso) return { date: "—", time: "" }
  const d = dayjs(iso)
  if (!d.isValid()) return { date: "—", time: "" }
  return {
    date: d.format("DD MMMM YYYY"),
    time: d.format("HH:mm"),
  }
}
