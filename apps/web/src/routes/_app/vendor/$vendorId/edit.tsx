import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { EditVendorForm } from "@/features/vendors/components/edit-vendor-form"
import { vendorQuery } from "@/features/vendors/services/vendors"

export const Route = createFileRoute("/_app/vendor/$vendorId/edit")({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(vendorQuery(params.vendorId)),
  component: EditVendor,
  staticData: { title: "Edit Vendor", breadcrumb: "Vendor" },
})

function EditVendor() {
  const { vendorId } = Route.useParams()
  const { data: vendor, isError } = useQuery(vendorQuery(vendorId))

  if (isError || !vendor) {
    return (
      <p className="px-2 text-sm text-destructive">Failed to load vendor.</p>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-2">
      <div className="rounded-md bg-white h-full px-4 py-2">
        <EditVendorForm vendor={vendor} />
      </div>
    </div>
  )
}
