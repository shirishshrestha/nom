import { NoServicesState } from "@/features/quotations/components/review/no-services-state"
import { useRulesReview } from "@/features/quotations/components/review/rules-review-context"
import { ServiceDetail } from "@/features/quotations/components/review/service-detail"

export function ServiceEditForm() {
  const {
    activeDoc,
    activeServiceId,
    attributeSet,
    drafts,
    setDraft,
    deletedServiceIds,
    deleteService,
  } = useRulesReview()

  const visible =
    activeDoc?.services.filter((s) => !deletedServiceIds.has(s.id)) ?? []
  const service = visible.find((s) => s.id === activeServiceId) ?? visible[0]

  if (visible.length === 0) return <NoServicesState className="flex-1" />

  if (!service || !attributeSet)
    return (
      <div className="flex flex-1 items-center justify-center rounded-md border bg-white text-sm text-muted-foreground">
        Select a quotation to edit.
      </div>
    )

  const index = visible.findIndex((s) => s.id === service.id)

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-hidden overflow-y-auto rounded-md border border-border bg-white px-6 py-3.5">
      <div className="flex items-center gap-3 py-2.5">
        <span className="rounded-md bg-sidebar-accent px-1.5 py-0.5 font-mono text-xs leading-5 text-gray-600">
          {String(index + 1).padStart(2, "0")}
        </span>
        <span className="truncate font-mono text-sm font-medium text-foreground">
          {service.canonicalName ?? "—"}
        </span>
      </div>

      <ServiceDetail
        key={service.id}
        service={service}
        attributeSet={attributeSet}
        initial={drafts[service.id]}
        onChange={setDraft}
        onDelete={deleteService}
      />
    </div>
  )
}
