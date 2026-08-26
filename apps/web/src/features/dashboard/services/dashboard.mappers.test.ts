import { describe, expect, it } from "vitest"
import { toStatCards } from "@/features/dashboard/services/dashboard.mappers"
import type { DashboardMetrics } from "@/features/dashboard/types"

function metrics(over: Partial<DashboardMetrics> = {}): DashboardMetrics {
  return {
    overcharges: {
      amount: 18290.42,
      trendPercent: 12.5,
      previousAmount: 16374,
    },
    verification: {
      percent: 90.25,
      trendPercent: -2,
      lineItemsVerified: 260,
      totalLineItems: 289,
      invoiceCount: 10,
    },
    exceptions: { count: 45, trendPercent: null },
    averageFlagsPerFile: { value: 4.5, trendPercent: 1.2 },
    status: { hasVendors: true, hasQuotations: true, hasTransactions: false },
    meta: { lastUpdated: "2026-07-14T00:00:00Z", period: "last-30-days" },
    ...over,
  }
}

describe("toStatCards", () => {
  it("formats money with cents, percent with 2dp", () => {
    const [overcharges, verification] = toStatCards(metrics())
    expect(overcharges.value).toBe("$18,290.42")
    expect(overcharges.sub).toBe("↑ Last month was $16,374.00")
    expect(verification.value).toBe("90.25%")
    expect(verification.sub).toBe("10 invoices")
  })

  it("derives trend badge direction and sign", () => {
    const [overcharges, verification, , avgFlags] = toStatCards(metrics())
    expect(overcharges.delta).toEqual({ dir: "up", text: "+12.50%" })
    expect(verification.delta).toEqual({ dir: "down", text: "-2.00%" })
    expect(avgFlags.delta).toEqual({ dir: "up", text: "+1.20%" })
  })

  it("omits the badge when trendPercent is null", () => {
    const [, , exceptions] = toStatCards(metrics())
    expect(exceptions.delta).toBeUndefined()
  })

  it("says exceptions improved when they fall", () => {
    const [, , exceptions] = toStatCards(
      metrics({ exceptions: { count: 45, trendPercent: -8 } })
    )
    expect(exceptions.note).toEqual({
      text: "Fewer exceptions than last period",
      dir: "down",
    })
    expect(exceptions.sub).toBe("Compared with the previous 30 days")
  })

  it("says exceptions worsened when they rise", () => {
    const [, , exceptions] = toStatCards(
      metrics({ exceptions: { count: 45, trendPercent: 20 } })
    )
    expect(exceptions.note).toEqual({
      text: "More exceptions than last period",
      dir: "up",
    })
    expect(exceptions.sub).toBe("Review flagged invoices")
  })

  it("says the flag rate worsened when it climbs", () => {
    const [, , , avgFlags] = toStatCards(metrics())
    expect(avgFlags.note).toEqual({ text: "Flag rate climbing", dir: "up" })
    expect(avgFlags.sub).toBe("Review flagged files")
  })

  it("says the flag rate improved when it falls", () => {
    const [, , , avgFlags] = toStatCards(
      metrics({ averageFlagsPerFile: { value: 4.5, trendPercent: -5 } })
    )
    expect(avgFlags.note).toEqual({ text: "Flag rate falling", dir: "down" })
    expect(avgFlags.sub).toBe("Compared with the previous 30 days")
  })

  it("claims nothing when there is no baseline to compare against", () => {
    const [, , exceptions] = toStatCards(metrics())
    expect(exceptions.note).toBeUndefined()
    expect(exceptions.sub).toBeUndefined()
  })

  it("points the overcharges arrow down when below last month", () => {
    const [overcharges] = toStatCards(
      metrics({
        overcharges: {
          amount: 12000,
          trendPercent: -26.7,
          previousAmount: 16374,
        },
      })
    )
    expect(overcharges.sub).toBe("↓ Last month was $16,374.00")
  })
})
