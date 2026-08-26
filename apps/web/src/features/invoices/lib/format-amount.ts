/** `(total, currency)` → e.g. "SGD 3,999.84". Falls back to a dash when total is absent. */
export function formatAmount(
  total: number | undefined,
  currency: string | null | undefined
): string {
  if (total == null) return "—"
  const value = total.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
  return currency ? `${currency} ${value}` : value
}
