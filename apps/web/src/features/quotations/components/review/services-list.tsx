import { cn } from "@nom/ui/lib/utils"
import { NoServicesState } from "@/features/quotations/components/review/no-services-state"
import { useRulesReview } from "@/features/quotations/components/review/rules-review-context"
import { matchesService } from "@/features/quotations/lib/service-search"
import type { ReviewService } from "@/features/quotations/types"

/**
 * Filters via early-return inside the map (not `.filter()`) so each row's
 * index badge keeps its full-list position even when other rows are hidden.
 */
export function ServicesList({
  services,
  searchTerm,
}: {
  services: ReviewService[]
  searchTerm: string
}) {
  const { activeServiceId, selectService, invalidServiceIds } = useRulesReview()

  if (services.length === 0)
    return <NoServicesState className="w-70 shrink-0" />

  const matches = (service: ReviewService) =>
    matchesService(service, searchTerm)

  if (searchTerm.trim() && !services.some(matches))
    return (
      <div className="flex w-70 shrink-0 items-center justify-center rounded-md border bg-white p-5 text-center text-sm text-muted-foreground">
        No services found.
      </div>
    )

  return (
    <div className="flex w-70 shrink-0 flex-col overflow-y-auto rounded-md border bg-white">
      {services.map((service, i) => {
        if (!matches(service)) return null

        const selected = service.id === activeServiceId
        return (
          <button
            type="button"
            key={service.id}
            onClick={() => selectService(service.id)}
            className={cn(
              "flex items-center gap-3 border-l-2 border-transparent px-5 py-2.5 text-left",
              selected ? "border-l-blue-400 bg-blue-50" : "hover:bg-muted/50"
            )}
          >
            <span className="rounded-md bg-sidebar-accent px-1.5 py-0.5 font-mono text-xs leading-5 text-gray-500">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium text-foreground">
                {service.title}
              </span>
              <span className="truncate font-mono text-xs text-gray-400 leading-5">
                {service.canonicalName ?? "—"}
              </span>
            </span>
            {invalidServiceIds.has(service.id) ? (
              <span className="ml-auto size-2 shrink-0 rounded-full bg-red-400" />
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
