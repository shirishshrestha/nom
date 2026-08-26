import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { InvoiceReview } from "@/features/invoices/components/review/invoice-review"
import { invoiceDocumentsQuery } from "@/features/invoices/services/invoices"
import { vendorQuery } from "@/features/vendors/services/vendors"

const reviewSearchSchema = z.object({
  vendorId: z.string().uuid(),
  documentIds: z.array(z.string().uuid()).min(1),
})

export const Route = createFileRoute("/_app/invoice/review")({
  validateSearch: reviewSearchSchema,
  loaderDeps: ({ search }) => ({ vendorId: search.vendorId }),
  loader: async ({ context, deps }) => {
    const [, vendor] = await Promise.all([
      context.queryClient.ensureQueryData(
        invoiceDocumentsQuery({ vendorId: deps.vendorId })
      ),
      context.queryClient.ensureQueryData(vendorQuery(deps.vendorId)),
    ])
    return { pageTitle: vendor.name }
  },
  component: InvoiceReviewRoute,
  staticData: {
    title: "Invoice Review",
    breadcrumb: "Invoice Review",
    breadcrumbParent: { label: "List Invoice", to: "/invoice" },
  },
})

function InvoiceReviewRoute() {
  const { vendorId, documentIds } = Route.useSearch()
  return <InvoiceReview vendorId={vendorId} documentIds={documentIds} />
}
