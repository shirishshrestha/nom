import { Button } from "@nom/ui/components/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nom/ui/components/select"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Plus } from "lucide-react"
import type { DateRange } from "react-day-picker"
import { DateRangeFilter } from "@/features/invoices/components/date-range-filter"
import type { StatusFilter } from "@/features/invoices/lib/invoice-filters"
import { vendorsQuery } from "@/features/vendors/services/vendors"

export function InvoicesToolbar({
  total,
  vendorId,
  onVendorChange,
  status,
  onStatusChange,
  dateRange,
  onDateRangeChange,
}: {
  total: number
  vendorId: string | undefined
  onVendorChange: (vendorId: string | undefined) => void
  status: StatusFilter
  onStatusChange: (status: StatusFilter) => void
  dateRange: DateRange | undefined
  onDateRangeChange: (range: DateRange | undefined) => void
}) {
  const { data: vendors = [] } = useQuery(vendorsQuery)
  const navigate = useNavigate()

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 pb-4">
      <div className="flex items-center gap-2.5">
        <h2 className="text-base leading-6 font-semibold">Invoice</h2>
        <span className="text-sm text-muted-foreground">{total}</span>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Select
          value={vendorId ?? "all"}
          onValueChange={(v) => onVendorChange(v === "all" ? undefined : v)}
        >
          <SelectTrigger className="px-2.5 shadow-xs">
            <SelectValue placeholder="Vendor" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Vendors</SelectItem>
            {vendors.map((vendor) => (
              <SelectItem key={vendor.id} value={vendor.id}>
                {vendor.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={status}
          onValueChange={(v) => onStatusChange(v as StatusFilter)}
        >
          <SelectTrigger className="gap-1.5 px-2.5 shadow-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="success">Success</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
          </SelectContent>
        </Select>

        <DateRangeFilter value={dateRange} onChange={onDateRangeChange} />

        <Button onClick={() => navigate({ to: "/invoice/add" })}>
          <Plus className="size-4" /> Add Invoice
        </Button>
      </div>
    </div>
  )
}
