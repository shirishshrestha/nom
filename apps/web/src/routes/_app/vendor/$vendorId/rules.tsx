import { createFileRoute } from "@tanstack/react-router"
import { RulesPage } from "@/features/rules/components/rules-page"
import { rulesQuery } from "@/features/rules/services/rules"
import { vendorQuery } from "@/features/vendors/services/vendors"

export const Route = createFileRoute("/_app/vendor/$vendorId/rules")({
  loader: async ({ context, params }) => {
    const [, vendor] = await Promise.all([
      context.queryClient.ensureQueryData(rulesQuery(params.vendorId)),
      context.queryClient.ensureQueryData(vendorQuery(params.vendorId)),
    ])
    return { pageTitle: `${vendor.name} Rules` }
  },
  component: VendorRules,
  staticData: {
    title: "Vendor's Rules",
    breadcrumb: "Rule",
    breadcrumbParent: { label: "Vendor", to: "/vendor/$vendorId" },
  },
})

function VendorRules() {
  const { vendorId } = Route.useParams()
  return <RulesPage vendorId={vendorId} />
}
