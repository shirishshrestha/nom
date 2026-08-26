import { Badge } from "@nom/ui/components/badge"
import { Button } from "@nom/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nom/ui/components/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nom/ui/components/table"
import { toast } from "@nom/ui/components/sonner"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { Ellipsis } from "lucide-react"
import type { DateRange } from "react-day-picker"
import { DeleteInvoiceDialog } from "@/features/invoices/components/delete-invoice-dialog"
import { InvoicesToolbar } from "@/features/invoices/components/invoices-toolbar"
import { formatAmount } from "@/features/invoices/lib/format-amount"
import { formatDocumentDate } from "@/features/invoices/lib/format-document-date"
import {
  matchesStatus,
  type StatusFilter,
} from "@/features/invoices/lib/invoice-filters"
import {
  invoiceDocumentsQuery,
  useDeleteDocumentMutation,
} from "@/features/invoices/services/invoices"
import { useDeleteInvoiceDialog } from "@/features/invoices/store/delete-invoice-dialog"
import type { InvoiceDocument } from "@/features/invoices/types"
import { DataTablePagination } from "@/shared/components/data-table-pagination"
import { formatFileSizeForDisplay } from "@/shared/lib/file"

const columns: ColumnDef<InvoiceDocument>[] = [
  {
    id: "index",
    header: "",
    cell: ({ row, table }) => {
      const { pageIndex, pageSize } = table.getState().pagination
      const n = pageIndex * pageSize + row.index + 1
      return (
        <span className="rounded-md bg-sidebar-accent px-1.5 py-0.5 font-mono leading-5 text-muted-foreground">
          {String(n).padStart(2, "0")}
        </span>
      )
    },
  },
  {
    accessorKey: "fileName",
    header: "File",
    cell: ({ row }) => (
      <div>
        <p className="text-sm font-medium">{row.original.fileName}</p>
        {row.original.fileSizeBytes != null ? (
          <p className="text-sm text-gray-600">
            {formatFileSizeForDisplay(row.original.fileSizeBytes)}
          </p>
        ) : null}
      </div>
    ),
  },
  {
    accessorKey: "effectiveFrom",
    header: "Upload Date",
    cell: ({ row }) => {
      const { date, time } = formatDocumentDate(row.original.createdAt)
      return (
        <div>
          <p className="text-sm font-medium text-gray-700">{date}</p>
          <p className="font-mono font-medium text-gray-400">{time}</p>
        </div>
      )
    },
  },
  {
    accessorKey: "reviewStatus",
    header: "Status",
    cell: ({ row }) => (
      <Badge
        variant={
          row.original.reviewStatus === "Completed" ? "success" : "warning"
        }
        className="px-1.5 py-0.5"
      >
        {row.original.reviewStatus}
      </Badge>
    ),
  },
  {
    id: "total",
    header: "Total Amount",
    cell: ({ row }) => (
      <p className="text-right text-sm font-bold text-gray-700">
        {formatAmount(
          row.original.metadata.total,
          row.original.metadata.currency
        )}
      </p>
    ),
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => <RowActions doc={row.original} />,
  },
]

function RowActions({ doc }: { doc: InvoiceDocument }) {
  const openDelete = useDeleteInvoiceDialog((s) => s.openFor)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Row actions">
          <Ellipsis className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          variant="destructive"
          onClick={() =>
            openDelete({ documentId: doc.documentId, fileName: doc.fileName })
          }
          className="text-sm"
        >
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function InvoicesTable({
  vendorId,
  onVendorChange,
  status,
  onStatusChange,
  dateFrom,
  dateTo,
  onDateRangeChange,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  vendorId: string | undefined
  onVendorChange: (vendorId: string | undefined) => void
  status: StatusFilter
  onStatusChange: (status: StatusFilter) => void
  dateFrom: string | undefined
  dateTo: string | undefined
  onDateRangeChange: (range: DateRange | undefined) => void
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}) {
  const navigate = useNavigate()
  const { data } = useQuery(
    invoiceDocumentsQuery({ vendorId, dateFrom, dateTo, page, limit: pageSize })
  )
  const remove = useDeleteDocumentMutation()
  const { open, target, close } = useDeleteInvoiceDialog()

  /**
   * ponytail: status stays a client-side filter over the current page — GET
   * /transaction/documents only takes one exact DocumentStatus, not the
   * success/pending tone groups this dropdown offers. `total`/pageCount below
   * reflect the server's vendor+date-filtered count, not the status-narrowed
   * one. Revisit if the backend adds a tone/group param.
   */
  const documents = (data?.documents ?? []).filter((doc) =>
    matchesStatus(doc, status)
  )
  const total = data?.totalCount ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  const dateRange: DateRange | undefined = dateFrom
    ? { from: new Date(dateFrom), to: dateTo ? new Date(dateTo) : undefined }
    : undefined

  const table = useReactTable({
    data: documents,
    columns,
    state: { pagination: { pageIndex: page - 1, pageSize } },
    autoResetPageIndex: false,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.documentId,
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <InvoicesToolbar
        total={total}
        vendorId={vendorId}
        onVendorChange={onVendorChange}
        status={status}
        onStatusChange={onStatusChange}
        dateRange={dateRange}
        onDateRangeChange={onDateRangeChange}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
        <div className="flex min-h-0 flex-col overflow-hidden rounded-md bg-white">
          <Table containerClassName="h-fit min-h-0 overflow-y-auto">
            <TableHeader className="sticky top-0 z-10 bg-background">
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow
                  key={headerGroup.id}
                  className="border-none bg-muted/50"
                >
                  {headerGroup.headers.map((header) => (
                    <TableHead
                      key={header.id}
                      className={
                        header.column.id === "total" ? "text-right" : undefined
                      }
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={columns.length}
                    className="h-24 text-center text-muted-foreground"
                  >
                    No invoices found.
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer"
                    onClick={() => {
                      const doc = row.original
                      const targetVendorId = doc.vendorId ?? vendorId
                      if (!targetVendorId) {
                        toast.error("This document has no vendor assigned")
                        return
                      }
                      navigate({
                        to: "/invoice/review",
                        search: {
                          vendorId: targetVendorId,
                          documentIds: [doc.documentId],
                        },
                      })
                    }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        className="py-2.5 text-sm first:pl-5 last:pr-5"
                        /** Don't navigate when interacting with the row actions menu. */
                        onClick={
                          cell.column.id === "actions"
                            ? (e) => e.stopPropagation()
                            : undefined
                        }
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <DataTablePagination
          total={total}
          page={page}
          pageCount={pageCount}
          pageSize={pageSize}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
      </div>

      <DeleteInvoiceDialog
        open={open}
        fileName={target?.fileName}
        isDeleting={remove.isPending}
        onOpenChange={(open) => {
          if (!open) close()
        }}
        onCancel={close}
        onConfirm={() => {
          if (!target) return
          remove.mutate(target.documentId, {
            onSuccess: () => {
              close()
              toast.success("Invoice deleted")
            },
          })
        }}
      />
    </div>
  )
}
