import { createFileRoute } from "@tanstack/react-router"
import { AddVendorForm } from "@/features/vendors/components/add-vendor-form"

export const Route = createFileRoute("/_app/vendor/add")({
  component: AddVendor,
  staticData: { title: "Add Vendor", breadcrumb: "Vendor" },
})

function AddVendor() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-2">
      <div className="h-full rounded-md bg-white px-4 py-2">
        <AddVendorForm />
      </div>
    </div>
  )
}
