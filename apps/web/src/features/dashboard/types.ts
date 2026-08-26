export type Trend = "up" | "down"

export type Stat = {
  label: string
  value: string
  delta?: { dir: Trend; text: string }
  note?: { text: string; dir?: Trend }
  sub?: string
}

export type DashboardMetrics = {
  overcharges: {
    amount: number
    trendPercent: number | null
    previousAmount: number | null
  }
  verification: {
    percent: number
    trendPercent: number | null
    lineItemsVerified: number
    totalLineItems: number
    invoiceCount: number
  }
  exceptions: {
    count: number
    trendPercent: number | null
  }
  averageFlagsPerFile: {
    value: number
    trendPercent: number | null
  }
  status: {
    hasVendors: boolean
    hasQuotations: boolean
    hasTransactions: boolean
  }
  meta: {
    lastUpdated: string
    period: string
  }
}
