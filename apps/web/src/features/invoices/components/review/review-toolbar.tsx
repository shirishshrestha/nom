import { Button } from "@nom/ui/components/button"
import { ButtonGroup } from "@nom/ui/components/button-group"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nom/ui/components/dropdown-menu"
import { Input } from "@nom/ui/components/input"
import { ChevronDown, Search } from "lucide-react"

export type SortOrder = "alphabetical" | "none"

export function ReviewToolbar({
  sortOrder,
  onSortOrderChange,
  searchTerm,
  onSearchChange,
}: {
  sortOrder: SortOrder
  onSortOrderChange: (order: SortOrder) => void
  searchTerm: string
  onSearchChange: (value: string) => void
}) {
  return (
    <div className="flex items-center gap-4">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="gap-1.5 shadow-xs">
            Sort by {sortOrder === "alphabetical" ? "Alphabetical" : "Default"}
            <ChevronDown className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onSortOrderChange("none")}>
            Default
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onSortOrderChange("alphabetical")}>
            Alphabetical
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ButtonGroup className="border-border shadow-xs">
        <Input
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search line items…"
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
    </div>
  )
}
