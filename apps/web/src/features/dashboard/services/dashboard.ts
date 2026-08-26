import { queryOptions } from "@tanstack/react-query"
import type { DashboardMetrics } from "@/features/dashboard/types"
import { api } from "@/lib/api"

const baseDashboardQueryKey = ["dashboard"] as const

/** API wraps payloads in { success, data, message, status } — unwrap to data. */
export const dashboardMetricsQuery = queryOptions({
  queryKey: baseDashboardQueryKey,
  queryFn: async () => {
    const res = await api.get<{ data: DashboardMetrics }>("/dashboard")
    return res.data.data
  },
})
