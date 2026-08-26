import {
  Delete01Icon,
  LeavingGeoFenceFreeIcons,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@nom/ui/components/button"
import { useState } from "react"
import { ConfirmDeleteServiceDialog } from "@/features/quotations/components/review/confirm-delete-service-dialog"
import { ServiceFormFields } from "@/features/quotations/components/review/service-form"
import { SourceChunkPanel } from "@/features/quotations/components/review/source-chunk-panel"
import type { ServiceFormValues } from "@/features/quotations/mappers/rules-review-mappers"
import type { AttributeSet, ReviewService } from "@/features/quotations/types"

/**
 * Shared by CardsReview and ServiceEditForm: the form fields, "View source" /
 * "Delete" row, and their dialogs/panel for a single service. Rendered with
 * `key={service.id}` so switching services remounts with fresh, closed state.
 */
export function ServiceDetail({
  service,
  attributeSet,
  initial,
  onChange,
  onDelete,
}: {
  service: ReviewService
  attributeSet: AttributeSet
  initial: ServiceFormValues | undefined
  onChange: (serviceId: string, values: ServiceFormValues) => void
  onDelete: (serviceId: string) => void
}) {
  const [sourceOpen, setSourceOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  return (
    <>
      <div className="flex flex-col gap-6">
        <ServiceFormFields
          service={service}
          attributeSet={attributeSet}
          initial={initial}
          onChange={onChange}
        />
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            data-active={sourceOpen}
            className="px-4 data-[active=true]:border-blue-500 data-[active=true]:bg-blue-200 data-[active=true]:text-blue-500"
            disabled={!service.meta.contentId}
            onClick={() => setSourceOpen((v) => !v)}
          >
            <HugeiconsIcon icon={LeavingGeoFenceFreeIcons} className="size-4" />
            {sourceOpen ? "Hide source" : "View source"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDeleteOpen(true)}
            className="gap-3 text-red-600"
          >
            <HugeiconsIcon icon={Delete01Icon} className="size-4" />
            Delete
          </Button>
        </div>

        {sourceOpen ? (
          <SourceChunkPanel
            contentId={service.meta.contentId}
            highlight={service.meta.sourceText}
          />
        ) : null}
      </div>

      <ConfirmDeleteServiceDialog
        open={deleteOpen}
        service={service}
        onOpenChange={setDeleteOpen}
        onConfirm={() => {
          onDelete(service.id)
          setDeleteOpen(false)
        }}
      />
    </>
  )
}
