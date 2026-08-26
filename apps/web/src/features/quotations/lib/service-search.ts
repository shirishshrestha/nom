import type { ReviewService } from "@/features/quotations/types"

/** Case-insensitive match over a service's title + canonical name. Empty query matches all. */
export function matchesService(service: ReviewService, query: string): boolean {
  const q = query.trim().toLowerCase()
  return (
    !q ||
    `${service.title} ${service.canonicalName ?? ""}`.toLowerCase().includes(q)
  )
}
