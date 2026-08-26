import { queryOptions } from "@tanstack/react-query"
import { authClient } from "@/lib/auth-client"

export const baseSessionQueryKey = ["session"] as const

/**
 * Session modeled as a query: prefetched in route guards/loaders via
 * ensureQueryData, then read in components with useSuspenseQuery.
 */
export const sessionQuery = queryOptions({
  queryKey: baseSessionQueryKey,
  queryFn: async () => {
    const { data } = await authClient.getSession()
    return data
  },
  staleTime: 5 * 60_000,
})
