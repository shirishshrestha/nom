import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { AddInvoiceForm } from "@/features/invoices/components/add-invoice-form"

const addSearchSchema = z.object({ vendorId: z.string().uuid().optional() })

export const Route = createFileRoute("/_app/invoice/add")({
  validateSearch: addSearchSchema,
  component: AddInvoice,
  staticData: {
    title: "Upload Invoice",
    breadcrumb: "Invoice",
  },
})

function AddInvoice() {
  const { vendorId } = Route.useSearch()
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-2">
      <AddInvoiceForm vendorId={vendorId} />
    </div>
  )
}
