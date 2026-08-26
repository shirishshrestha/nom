import { createFileRoute, stripSearchParams } from "@tanstack/react-router"
import { z } from "zod"
import { QuotationsTable } from "@/features/quotations/components/table/quotations-table"
import { vendorQuery } from "@/features/vendors/services/vendors"

const defaultSearch = { page: 1, pageSize: 10 }

/**
 * URL-persisted table state, so a filtered view is shareable and survives a
 * reload or Back. .catch() keeps a hand-edited/stale URL from throwing; the
 * filters are optional, so an unset one leaves the URL clean.
 */
const searchSchema = z.object({
  page: z.number().int().min(1).catch(1).default(defaultSearch.page),
  pageSize: z.number().int().catch(10).default(defaultSearch.pageSize),
  q: z.string().optional().catch(undefined),
  model: z.enum(["Flat", "Tiered"]).optional().catch(undefined),
})

export const Route = createFileRoute("/_app/vendor/$vendorId/")({
  validateSearch: searchSchema,
  search: { middlewares: [stripSearchParams(defaultSearch)] },
  /**
   * Only the vendor is loaded here — the page title needs it. The quotations
   * list is left to the component: it depends on five search params, and
   * prefetching it would either block the route on every filter change or fire
   * a second request whenever the loader's key drifted from the component's.
   * QuotationsTable renders skeleton rows while it lands.
   */
  loader: async ({ context, params }) => {
    const vendor = await context.queryClient.ensureQueryData(
      vendorQuery(params.vendorId)
    )
    return { pageTitle: `${vendor.name} Quotations` }
  },
  component: VendorQuotations,
  staticData: {
    title: "Vendor's Quotations",
    breadcrumb: "Quotations",
    breadcrumbParent: { label: "Vendor", to: "/vendor" },
  },
})

function VendorQuotations() {
  const { vendorId } = Route.useParams()
  const { page, pageSize, q, model } = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-2">
      <QuotationsTable
        vendorId={vendorId}
        page={page}
        pageSize={pageSize}
        filters={{ q, model }}
        onPageChange={(next) =>
          navigate({ search: (prev) => ({ ...prev, page: next }) })
        }
        onPageSizeChange={(size) =>
          navigate({ search: (prev) => ({ ...prev, pageSize: size, page: 1 }) })
        }
        /** Any filter narrows the result, so page 1 or the user lands on an empty page. */
        onFiltersChange={(next) =>
          navigate({
            search: (prev) => ({ ...prev, ...next, page: 1 }),
            replace: true,
          })
        }
      />
    </div>
  )
}
