import { Alert02Icon, ArrowDown01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Badge } from "@nom/ui/components/badge"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@nom/ui/components/collapsible"
import { cn } from "@nom/ui/lib/utils"
import { NoServicesState } from "@/features/quotations/components/review/no-services-state"
import { useRulesReview } from "@/features/quotations/components/review/rules-review-context"
import { ServiceDetail } from "@/features/quotations/components/review/service-detail"
import { matchesService } from "@/features/quotations/lib/service-search"
import type { ReviewService } from "@/features/quotations/types"

/**
 * Single-column accordion. Expansion reuses the context's `activeServiceId`
 * (shared with Split), so only one row is open and switching files collapses it.
 */
export function CardsReview({
  services,
  searchTerm,
}: {
  services: ReviewService[]
  searchTerm: string
}) {
  const {
    activeServiceId,
    selectService,
    attributeSet,
    drafts,
    setDraft,
    deleteService,
    serviceIssueCounts,
  } = useRulesReview()

  if (services.length === 0) return <NoServicesState className="mx-4 flex-1" />

  const matches = (service: ReviewService) =>
    matchesService(service, searchTerm)
  if (searchTerm.trim() && !services.some(matches))
    return (
      <div className="mx-4 flex items-center justify-center rounded-md border bg-white p-5 text-center text-sm text-muted-foreground">
        No services found.
      </div>
    )

  return (
    <div className="mx-4 flex min-h-0 flex-1 flex-col overflow-y-auto rounded-md border-none bg-white">
      {services.map((service, i) => {
        if (!matches(service)) return null
        const open = service.id === activeServiceId
        const issues = serviceIssueCounts.get(service.id) ?? 0
        return (
          <Collapsible
            key={service.id}
            open={open}
            onOpenChange={(o) => selectService(o ? service.id : null)}
            className={cn("border-b last:border-b-0", open && "border-b-0")}
          >
            <CollapsibleTrigger
              className={cn(
                "flex w-full items-center gap-3 px-5 py-2.5 text-left",
                open
                  ? "border-b border-b-gray-200 bg-muted"
                  : "hover:bg-muted/50"
              )}
            >
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                className={cn(
                  "size-4 shrink-0 -rotate-90 text-gray-400 transition-transform",
                  open && "rotate-0"
                )}
              />
              <span
                className={cn(
                  "rounded-md bg-sidebar-accent px-1.5 py-0.5 font-mono text-xs leading-5 text-gray-500",
                  issues && "bg-red-50 text-red-500"
                )}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium text-foreground">
                  {service.title}
                </span>
                <span className="truncate font-mono text-xs leading-5 text-gray-600">
                  {service.canonicalName ?? "—"}
                </span>
              </span>
              {issues > 0 ? (
                <Badge
                  variant="outline"
                  className="ml-auto shrink-0 gap-1.5 rounded-none bg-red-100 px-0.5 py-px text-xs leading-4 text-red-500"
                >
                  <HugeiconsIcon icon={Alert02Icon} className="size-4" />
                  {issues} issue{issues > 1 ? "s" : ""}
                </Badge>
              ) : null}
            </CollapsibleTrigger>

            <CollapsibleContent>
              {attributeSet ? (
                <div className="bg-muted px-6 py-3.5">
                  <ServiceDetail
                    key={service.id}
                    service={service}
                    attributeSet={attributeSet}
                    initial={drafts[service.id]}
                    onChange={setDraft}
                    onDelete={deleteService}
                  />
                </div>
              ) : null}
            </CollapsibleContent>
          </Collapsible>
        )
      })}
    </div>
  )
}
