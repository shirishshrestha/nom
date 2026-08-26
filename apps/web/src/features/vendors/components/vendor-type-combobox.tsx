import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@nom/ui/components/popover"
import { cn } from "@nom/ui/lib/utils"
import { useQuery } from "@tanstack/react-query"
import { Check, ChevronDown, Plus } from "lucide-react"
import { useState } from "react"
import { vendorTypesQuery } from "@/features/vendors/services/vendors"

type Props = {
  id?: string
  value?: string
  onChange: (value: string) => void
  "aria-invalid"?: boolean
}

/**
 * ponytail: click + type-to-filter only, no arrow-key nav. Swap to cmdk if
 * keyboard navigation becomes a requirement.
 */
export function VendorTypeCombobox({ id, value, onChange, ...props }: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const { data: types = [] } = useQuery(vendorTypesQuery)

  const filtered = types.filter((t) =>
    t.toLowerCase().includes(search.trim().toLowerCase())
  )
  const exactMatch = types.some(
    (t) => t.toLowerCase() === search.trim().toLowerCase()
  )

  function select(next: string) {
    onChange(next)
    setSearch("")
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        id={id}
        type="button"
        aria-invalid={props["aria-invalid"]}
        className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-white px-3 py-1 text-sm shadow-xs transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20"
      >
        <span className={cn(!value && "text-muted-foreground")}>
          {value || "Select from the list or create new"}
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent className="p-1">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search or create..."
          className="mb-1 w-full rounded-md bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
        />
        <div className="max-h-56 overflow-y-auto">
          {filtered.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => select(t)}
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
            >
              {t}
              {value === t && <Check className="size-4" />}
            </button>
          ))}
          {search.trim() && !exactMatch && (
            <button
              type="button"
              onClick={() => select(search.trim())}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
            >
              <Plus className="size-4" />
              Create "{search.trim()}"
            </button>
          )}
          {!filtered.length && !search.trim() && (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">
              No types yet — type to create one.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
