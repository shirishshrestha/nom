import { Skeleton } from "@nom/ui/components/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nom/ui/components/table"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table"
import {
  AttributeCell,
  TierCell,
} from "@/features/quotations/components/table/attribute-cell"
import { QuotationsToolbar } from "@/features/quotations/components/table/quotations-toolbar"
import { vendorQuotationsQuery } from "@/features/quotations/services/quotations"
import type {
  AttributeSet,
  Quotation,
  QuotationFilters,
} from "@/features/quotations/types"
import { DataTablePagination } from "@/shared/components/data-table-pagination"
import { TruncatedText } from "@/shared/components/truncated-text"
import { useDebouncedValue } from "@/shared/hooks/use-debounced-value"

/**
 * The middle columns are generated from the response's attribute set (one per
 * display attribute), so the table adapts to whichever set the vendor's page
 * carries. `remarks` is skipped — it's already surfaced by the Conditions
 * column. The Tier column is added only when some group is actually tiered, so
 * its labels aren't repeated inside every attribute cell. `attributeSet` is
 * null for a vendor with no committed services.
 */
function buildColumns(
  attributeSet: AttributeSet | null,
  hasTiers: boolean
): ColumnDef<Quotation>[] {
  const attrColumns: ColumnDef<Quotation>[] = (attributeSet?.attributes ?? [])
    .filter((attr) => attr.key !== "remarks")
    .map((attr) => ({
      id: attr.key,
      header: attr.label,
      enableGlobalFilter: false,
      cell: ({ row }) => (
        <AttributeCell tiers={row.original.tiers} attr={attr} />
      ),
    }))

  const tierColumn: ColumnDef<Quotation>[] = hasTiers
    ? [
        {
          id: "tier",
          header: "Tier",
          enableGlobalFilter: false,
          cell: ({ row }) => <TierCell tiers={row.original.tiers} />,
        },
      ]
    : []

  return [
    {
      id: "index",
      header: "",
      enableGlobalFilter: false,
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
      accessorKey: "title",
      header: "Quotation",
      cell: ({ row }) => (
        <div>
          <TruncatedText className="max-w-55 text-sm font-medium">
            {row.original.title}
          </TruncatedText>
          <TruncatedText className="max-w-55 font-mono text-muted-foreground">
            {row.original.code}
          </TruncatedText>
        </div>
      ),
    },
    ...tierColumn,
    ...attrColumns,
    {
      accessorKey: "conditions",
      header: "Conditions",
      cell: ({ row }) => (
        <TruncatedText
          lines={3}
          className="min-w-70 max-w-70 text-sm text-muted-foreground"
        >
          {row.original.conditions}
        </TruncatedText>
      ),
    },
  ]
}

/**
 * Mirrors the shape of the real cell for `columnId`, so the rows don't visibly
 * re-lay-out when data lands: the index badge is a chip, Quotation stacks a
 * title over its canonical code, Conditions is a 3-line clamp, and Tier and the
 * attribute columns stack one line per tier.
 */
function SkeletonCell({ columnId }: { columnId: string }) {
  if (columnId === "index") return <Skeleton className="h-5 w-6" />

  if (columnId === "title")
    return (
      <div className="space-y-1.5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3.5 w-28" />
      </div>
    )

  if (columnId === "conditions")
    return (
      <div className="min-w-70 space-y-1.5">
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-4/5" />
      </div>
    )

  return (
    <div className="space-y-1.5">
      <Skeleton className="h-4 w-20" />
      <Skeleton className="h-4 w-14" />
    </div>
  )
}

/**
 * Placeholder rows for the first load. Without it the empty row model renders
 * "No quotations found." while the request is still in flight, which reads as
 * "this vendor has none".
 *
 * ponytail: two tier lines per cell — the common case. A cold load can't know
 * the real count (or the attribute columns: they come from the same response),
 * so the widest guess would flash emptier than it fills.
 */
function QuotationRowsSkeleton({
  rows,
  columnIds,
}: {
  rows: number
  columnIds: string[]
}) {
  return Array.from({ length: rows }, (_, row) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length placeholder list
    <TableRow key={row} className="align-top">
      {columnIds.map((columnId) => (
        <TableCell
          key={columnId}
          className="px-3.5 py-2.5 first:pl-5 last:pr-5"
        >
          <SkeletonCell columnId={columnId} />
        </TableCell>
      ))}
    </TableRow>
  ))
}

/**
 * The filters live in the URL, but the search box does *not* read from it:
 * `search` is local so every keystroke paints immediately, and only its
 * debounced value is written back. Binding the input straight to the URL param
 * put a router navigate + schema re-validation between the key press and the
 * character appearing.
 */
export function QuotationsTable({
  vendorId,
  page,
  pageSize,
  filters,
  onPageChange,
  onPageSizeChange,
  onFiltersChange,
}: {
  vendorId: string
  page: number
  pageSize: number
  filters: QuotationFilters
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  onFiltersChange: (filters: QuotationFilters) => void
}) {
  const [search, setSearch] = useState(filters.q ?? "")
  const debouncedSearch = useDebouncedValue(search.trim(), 300)

  /**
   * One-way sync, local → URL. Safe because filter writes use `replace: true`:
   * typing leaves no history entries, so `filters.q` never changes underneath
   * this and there's nothing to fight over. `|| undefined` clears the param
   * rather than leaving `?q=`.
   */
  useEffect(() => {
    if (debouncedSearch !== (filters.q ?? ""))
      onFiltersChange({ ...filters, q: debouncedSearch || undefined })
  }, [debouncedSearch, filters, onFiltersChange])

  const { data, isPending } = useQuery(
    vendorQuotationsQuery(vendorId, page, pageSize, filters)
  )
  const quotations = data?.quotations ?? []
  const attributeSet = data?.attributeSet ?? null
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  const hasTiers = quotations.some((quotation) =>
    quotation.tiers.some((tier) => tier.label != null)
  )
  const columns = buildColumns(attributeSet, hasTiers)

  const table = useReactTable({
    data: quotations,
    columns,
    state: { pagination: { pageIndex: page - 1, pageSize } },
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <QuotationsToolbar
        total={total}
        isPending={isPending}
        files={data?.files ?? []}
        fileCount={data?.fileCount ?? 0}
        model={filters.model}
        onModelChange={(model) => onFiltersChange({ ...filters, model })}
        search={search}
        onSearch={setSearch}
        vendorId={vendorId}
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
                        header.column.id === "actions" ? "w-12" : undefined
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
              {isPending ? (
                <QuotationRowsSkeleton
                  rows={pageSize}
                  columnIds={table.getAllLeafColumns().map((col) => col.id)}
                />
              ) : table.getRowModel().rows.length === 0 ? (
                <TableRow className="px-5 py-2.5">
                  <TableCell
                    colSpan={columns.length}
                    className="h-24 border-b border-b-gray-100 p-0 text-center text-muted-foreground"
                  >
                    No quotations found.
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id} className="align-top">
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        className="px-3.5 py-2.5 text-sm first:pl-5 last:pr-5"
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
    </div>
  )
}
