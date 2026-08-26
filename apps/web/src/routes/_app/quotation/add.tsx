import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { AddQuotationForm } from "@/features/quotations/components/add-quotation-form"

const addSearchSchema = z.object({ vendorId: z.string().uuid().optional() })

export const Route = createFileRoute("/_app/quotation/add")({
  validateSearch: addSearchSchema,
  component: AddQuotation,
  staticData: { title: "Add Quotation", breadcrumb: "Quotation" },
})

function AddQuotation() {
  const { vendorId } = Route.useSearch()
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-2">
      <div className="flex flex-1 flex-col gap-3 px-2 py-1.5">
        <AddQuotationForm vendorId={vendorId} />
      </div>
    </div>
  )
}
