import { createFileRoute, stripSearchParams } from "@tanstack/react-router"
import { z } from "zod"
import { InvoicesTable } from "@/features/invoices/components/invoices-table"
import { invoiceDocumentsQuery } from "@/features/invoices/services/invoices"
import dayjs from "dayjs"

const DATE_FORMAT = "YYYY-MM-DD"

const defaultSearch = { status: "all" as const, page: 1, pageSize: 10 }

const searchSchema = z.object({
  vendorId: z.string().uuid().optional(),
  status: z
    .enum(["all", "success", "pending"])
    .catch("all")
    .default(defaultSearch.status),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  page: z.number().int().min(1).catch(1).default(defaultSearch.page),
  pageSize: z.number().int().catch(10).default(defaultSearch.pageSize),
})

export const Route = createFileRoute("/_app/invoice/")({
  validateSearch: searchSchema,
  search: { middlewares: [stripSearchParams(defaultSearch)] },
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(
      invoiceDocumentsQuery({
        vendorId: deps.vendorId,
        dateFrom: deps.dateFrom,
        dateTo: deps.dateTo,
        page: deps.page,
        limit: deps.pageSize,
      })
    ),
  component: InvoicesPage,
  staticData: { title: "Invoice", breadcrumb: "List Invoice" },
})

function InvoicesPage() {
  const { vendorId, status, dateFrom, dateTo, page, pageSize } =
    Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-2">
      <InvoicesTable
        vendorId={vendorId}
        onVendorChange={(next) =>
          navigate({ search: (prev) => ({ ...prev, vendorId: next, page: 1 }) })
        }
        status={status}
        onStatusChange={(next) =>
          navigate({ search: (prev) => ({ ...prev, status: next, page: 1 }) })
        }
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateRangeChange={(range) =>
          navigate({
            search: (prev) => ({
              ...prev,
              dateFrom: range?.from
                ? dayjs(range.from).format(DATE_FORMAT)
                : undefined,
              dateTo: range?.to
                ? dayjs(range.to).format(DATE_FORMAT)
                : undefined,
              page: 1,
            }),
          })
        }
        page={page}
        pageSize={pageSize}
        onPageChange={(next) =>
          navigate({ search: (prev) => ({ ...prev, page: next }) })
        }
        onPageSizeChange={(size) =>
          navigate({ search: (prev) => ({ ...prev, pageSize: size, page: 1 }) })
        }
      />
    </div>
  )
}
