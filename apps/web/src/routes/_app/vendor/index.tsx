import { ThreeDScaleIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@nom/ui/components/button"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { VendorTable } from "@/features/vendors/components/vendor-table"
import { vendorsQuery } from "@/features/vendors/services/vendors"

function AddVendorButton() {
  return (
    <Button size="sm" asChild>
      <Link to="/vendor/add">
        <HugeiconsIcon icon={ThreeDScaleIcon} size={16} /> Add Vendor
      </Link>
    </Button>
  )
}

export const Route = createFileRoute("/_app/vendor/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(vendorsQuery),
  component: VendorList,
  staticData: {
    title: "Vendor",
    breadcrumb: "Vendor",
    PageActions: AddVendorButton,
  },
})

function VendorList() {
  const { data: vendors = [], isError } = useQuery(vendorsQuery)

  if (isError) {
    return (
      <p className="px-2 text-sm text-destructive">
        Failed to load vendors. Please try again.
      </p>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-2">
      <div className="flex-1 px-2 py-1.5">
        <VendorTable vendors={vendors} />
      </div>
    </div>
  )
}
