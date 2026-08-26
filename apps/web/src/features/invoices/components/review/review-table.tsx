import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nom/ui/components/table"
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { useInvoiceReview } from "@/features/invoices/components/review/invoice-review-context"
import { useLineItemSelection } from "@/features/invoices/components/review/line-item-selection-context"
import { StatusBadge } from "@/features/invoices/components/review/status-badge"
import { formatAmount } from "@/features/invoices/lib/format-amount"
import {
  displayStatus,
  statusRowHighlight,
} from "@/features/invoices/lib/line-item-status"
import type { LineItem } from "@/features/invoices/types"
import { TruncatedText } from "@/shared/components/truncated-text"
import { cn } from "@nom/ui/lib/utils"

function columns(
  vendorName: string | undefined,
  isMatching: boolean
): ColumnDef<LineItem>[] {
  return [
    {
      id: "invoice",
      header: "Invoice",
      cell: ({ row }) => (
        <div className="text-sm text-gray-950">
          <p className="font-medium">{row.original.invoiceRef}</p>
          <p>{vendorName}</p>
        </div>
      ),
    },
    {
      id: "description",
      header: "Description",
      cell: ({ row }) => {
        const { expectedAmount, billedAmount } = row.original.reconciliation
        const showExpectedCharged =
          row.original.status === "mismatch" &&
          expectedAmount != null &&
          billedAmount != null
        return (
          <div>
            <TruncatedText className="max-w-sm text-sm font-medium text-gray-950">
              {row.original.description}
            </TruncatedText>
            {showExpectedCharged ? (
              <p className="font-mono text-sm text-red-600">
                Expected {formatAmount(expectedAmount, undefined)} · Charged{" "}
                {formatAmount(billedAmount, undefined)}
              </p>
            ) : null}
          </div>
        )
      },
    },
    {
      id: "amount",
      header: "Amount",
      cell: ({ row }) => {
        const { billedAmount, direction, expectedAmount } =
          row.original.reconciliation

        const rawAmount = row.original.attributes.amount
        const amount =
          billedAmount ??
          (typeof rawAmount === "number" ? rawAmount : undefined)
        return (
          <div className="space-y-1.5 text-right font-mono text-sm text-foreground">
            <p>{formatAmount(amount, undefined)}</p>
            {direction && direction !== "match" && expectedAmount != null ? (
              <p
                className={cn(
                  // Accepting settles the verdict, not the numbers — `direction` stays
                  // "under"/"over" forever, so the alert tone has to key off status.
                  row.original.status === "mismatch"
                    ? "text-red-600"
                    : "text-muted-foreground"
                )}
              >
                {formatAmount(Math.abs(expectedAmount), undefined)}
              </p>
            ) : null}
          </div>
        )
      },
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => (
        <StatusBadge status={displayStatus(row.original.status, isMatching)} />
      ),
    },
    {
      id: "reason",
      header: "Reason",
      cell: ({ row }) => (
        <TruncatedText className="max-w-xs text-sm text-gray-600" lines={2}>
          {row.original.reviewNote ?? row.original.narrative ?? "—"}
        </TruncatedText>
      ),
    },
  ]
}

export function ReviewTable({
  lineItems,
  vendorName,
}: {
  lineItems: LineItem[]
  vendorName: string | undefined
}) {
  const { select } = useLineItemSelection()
  const { activeDoc } = useInvoiceReview()
  const cols = columns(vendorName, activeDoc?.isMatching ?? false)
  const table = useReactTable({
    data: lineItems,
    columns: cols,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
  })

  return (
    <Table containerClassName="h-fit min-h-0 overflow-y-auto">
      <TableHeader className="sticky top-0 z-10 bg-muted">
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id} className="border-none">
            {headerGroup.headers.map((header) => (
              <TableHead
                key={header.id}
                className={cn(
                  "py-2.5",
                  header.column.id === "amount" && "text-right"
                )}
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
              colSpan={cols.length}
              className="h-24 text-center text-muted-foreground"
            >
              No line items found.
            </TableCell>
          </TableRow>
        ) : (
          table.getRowModel().rows.map((row) => (
            <TableRow
              key={row.id}
              className={cn(
                "cursor-pointer",
                statusRowHighlight(row.original.status)
              )}
              onClick={() => select(row.original.id)}
            >
              {row.getVisibleCells().map((cell) => (
                <TableCell
                  key={cell.id}
                  className="py-2.5 text-sm first:pl-5 last:pr-5"
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  )
}
