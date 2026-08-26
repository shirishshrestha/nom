import type { DashboardMetrics, Stat, Trend } from "@/features/dashboard/types"

function formatUsd(amount: number): string {
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function trendBadge(trendPercent: number | null): Stat["delta"] {
  if (trendPercent == null) return undefined
  return {
    dir: trendPercent >= 0 ? "up" : "down",
    text: `${trendPercent >= 0 ? "+" : ""}${trendPercent.toFixed(2)}%`,
  }
}

type TrendCopy = { note: string; sub: string }

/**
 * Copy is chosen by whether the metric moved the *good* way, not by the sign of the
 * delta — exceptions and flags improve when they fall, accuracy when it rises. Passing
 * `goodWhen` per metric is what keeps the two apart; without it every caller silently
 * reads a falling exception count as bad news. `dir` stays the factual trend direction,
 * since it only drives which arrow is drawn. A null trend has no baseline to compare
 * against, so it gets no note rather than an unearned claim.
 */
function trendNote(
  trendPercent: number | null,
  goodWhen: Trend,
  copy: { improving: TrendCopy; worsening: TrendCopy }
): Pick<Stat, "note" | "sub"> {
  if (trendPercent == null) return {}
  const dir: Trend = trendPercent >= 0 ? "up" : "down"
  const chosen = dir === goodWhen ? copy.improving : copy.worsening
  return { note: { text: chosen.note, dir }, sub: chosen.sub }
}

const VS_LAST_PERIOD = "Compared with the previous 30 days"

export function toStatCards(m: DashboardMetrics): Stat[] {
  const { overcharges, verification, exceptions, averageFlagsPerFile } = m
  const verificationDelta = trendBadge(verification.trendPercent)
  return [
    {
      label: "Potential Overcharges Detected",
      value: formatUsd(overcharges.amount),
      delta: trendBadge(overcharges.trendPercent),
      sub:
        overcharges.previousAmount == null
          ? undefined
          : `${overcharges.amount >= overcharges.previousAmount ? "↑" : "↓"} Last month was ${formatUsd(overcharges.previousAmount)}`,
    },
    {
      label: "Verification Accuracy",
      value: `${verification.percent.toFixed(2)}%`,
      delta: verificationDelta,
      note: {
        text: `${verification.lineItemsVerified} of ${verification.totalLineItems} line items`,
        dir: verificationDelta?.dir,
      },
      sub: `${verification.invoiceCount} invoices`,
    },
    {
      label: "Exceptions Requiring Action",
      value: `${exceptions.count}`,
      delta: trendBadge(exceptions.trendPercent),
      ...trendNote(exceptions.trendPercent, "down", {
        improving: {
          note: "Fewer exceptions than last period",
          sub: VS_LAST_PERIOD,
        },
        worsening: {
          note: "More exceptions than last period",
          sub: "Review flagged invoices",
        },
      }),
    },
    {
      label: "Average flags/file",
      value: `${averageFlagsPerFile.value}`,
      delta: trendBadge(averageFlagsPerFile.trendPercent),
      ...trendNote(averageFlagsPerFile.trendPercent, "down", {
        improving: { note: "Flag rate falling", sub: VS_LAST_PERIOD },
        worsening: {
          note: "Flag rate climbing",
          sub: "Review flagged files",
        },
      }),
    },
  ]
}
