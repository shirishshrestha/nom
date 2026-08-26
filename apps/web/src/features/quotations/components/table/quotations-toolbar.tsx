import { Button } from "@nom/ui/components/button"
import { ButtonGroup } from "@nom/ui/components/button-group"
import { Input } from "@nom/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nom/ui/components/select"
import { Skeleton } from "@nom/ui/components/skeleton"
import { Link } from "@tanstack/react-router"
import { Plus, Search } from "lucide-react"
import { QuotationsFilesMenu } from "@/features/quotations/components/table/quotations-files-menu"
import type { QuotationFile, ServiceModel } from "@/features/quotations/types"

const ALL_MODELS = "all"

export function QuotationsToolbar({
  total,
  isPending,
  files,
  fileCount,
  model,
  onModelChange,
  search,
  onSearch,
  vendorId,
}: {
  total: number
  isPending: boolean
  files: QuotationFile[]
  fileCount: number
  model?: ServiceModel
  onModelChange: (model?: ServiceModel) => void
  search: string
  onSearch: (value: string) => void
  vendorId: string
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 pb-3">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold">Quotations</h2>
        {/* A hard "0" next to the heading reads as "this vendor has none". */}
        {isPending ? (
          <Skeleton className="h-4 w-5" />
        ) : (
          <span className="text-sm text-muted-foreground">{total}</span>
        )}
        <QuotationsFilesMenu files={files} fileCount={fileCount} />
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Select
          value={model ?? ALL_MODELS}
          onValueChange={(value) =>
            onModelChange(
              value === ALL_MODELS ? undefined : (value as ServiceModel)
            )
          }
        >
          <SelectTrigger className="shadow-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_MODELS}>All Model</SelectItem>
            <SelectItem value="Flat">Flat</SelectItem>
            <SelectItem value="Tiered">Tiered</SelectItem>
          </SelectContent>
        </Select>

        <ButtonGroup className="border-border shadow-xs">
          <Input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search Quotations..."
            className="w-56 border-r-border text-sm"
          />
          <Button
            variant="outline"
            aria-label="Search"
            className="bg-white px-2.5"
          >
            <Search className="size-4" />
          </Button>
        </ButtonGroup>

        <Button variant="outline" asChild>
          <Link to="/vendor/$vendorId/rules" params={{ vendorId }}>
            Add Rule
          </Link>
        </Button>
        <Button size="sm" asChild>
          <Link to="/quotation/add" search={{ vendorId }}>
            <Plus className="size-4" /> Add Quotation
          </Link>
        </Button>
      </div>
    </div>
  )
}
