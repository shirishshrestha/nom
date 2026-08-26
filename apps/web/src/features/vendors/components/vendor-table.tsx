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
import { Link, useNavigate } from "@tanstack/react-router"
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { EllipsisVertical } from "lucide-react"
import { DeleteVendorDialog } from "@/features/vendors/components/delete-vendor-dialog"
import type { Vendor } from "@/features/vendors/schemas"
import { useDeleteVendorMutation } from "@/features/vendors/services/vendors"
import { useDeleteVendorDialog } from "@/features/vendors/store/delete-vendor-dialog"
import { TruncatedText } from "@/shared/components/truncated-text"

export function VendorTable({ vendors }: { vendors: Vendor[] }) {
  const navigate = useNavigate()
  const { open, target, openFor, close } = useDeleteVendorDialog()
  const remove = useDeleteVendorMutation()

  const columns: ColumnDef<Vendor>[] = [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => (
        <TruncatedText className="max-w-[220px] font-medium">
          {row.original.name}
        </TruncatedText>
      ),
    },
    {
      accessorKey: "code",
      header: "Code",
      cell: ({ row }) =>
        row.original.code ? (
          <Badge variant="outline" className="text-muted-foreground">
            {row.original.code}
          </Badge>
        ) : (
          "-"
        ),
    },
    {
      accessorKey: "type",
      header: "Type",
      cell: ({ row }) => row.original.type || "-",
    },
    {
      accessorKey: "location",
      header: "Location",
      cell: ({ row }) => (
        <TruncatedText className="max-w-[200px]">
          {row.original.location || "-"}
        </TruncatedText>
      ),
    },
    {
      accessorKey: "comments",
      header: "Comment",
      cell: ({ row }) => (
        <TruncatedText className="max-w-[280px] text-muted-foreground">
          {row.original.comments || "-"}
        </TruncatedText>
      ),
    },
    {
      id: "actions",
      enableSorting: false,
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8">
              <EllipsisVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link
                to="/vendor/$vendorId/rules"
                params={{ vendorId: row.original.id }}
              >
                Rules
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link
                to="/vendor/$vendorId/edit"
                params={{ vendorId: row.original.id }}
              >
                Edit
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onClick={() =>
                openFor({ id: row.original.id, name: row.original.name })
              }
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]

  const table = useReactTable({
    data: vendors,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
  })

  return (
    <div className="overflow-y-auto rounded-md border border-border bg-white">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} className="bg-muted">
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
          {table.getRowModel().rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="h-24 text-center text-muted-foreground"
              >
                No vendors yet.
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                className="cursor-pointer"
                onClick={() =>
                  navigate({
                    to: "/vendor/$vendorId",
                    params: { vendorId: row.original.id },
                  })
                }
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    /** Don't navigate when interacting with the row actions menu. */
                    onClick={
                      cell.column.id === "actions"
                        ? (e) => e.stopPropagation()
                        : undefined
                    }
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <DeleteVendorDialog
        open={open}
        vendorName={target?.name}
        isDeleting={remove.isPending}
        onOpenChange={(open) => {
          if (!open) close()
        }}
        onCancel={close}
        onConfirm={() => {
          if (!target) return
          remove.mutate(target.id, {
            onSuccess: () => {
              close()
              toast.success("Vendor deleted")
            },
          })
        }}
      />
    </div>
  )
}
