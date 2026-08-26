import { Button } from "@nom/ui/components/button"
import { Calendar } from "@nom/ui/components/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@nom/ui/components/popover"
import { CalendarCog } from "lucide-react"
import { useState } from "react"
import type { DateRange } from "react-day-picker"
import dayjs from "dayjs"

function formatRange(range: DateRange | undefined): string {
  if (!range?.from) return "Date range"
  if (!range.to) return dayjs(range.from).format("DD MMM YYYY")
  return `${dayjs(range.from).format("DD MMM YYYY")} - ${dayjs(range.to).format("DD MMM YYYY")}`
}

export function DateRangeFilter({
  value,
  onChange,
}: {
  value: DateRange | undefined
  onChange: (range: DateRange | undefined) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<DateRange | undefined>(value)

  const isDirty = formatRange(draft) !== formatRange(value)

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next) setDraft(value)
  }

  function handleSelect(range: DateRange | undefined) {
    if (!range?.from) return
    setDraft(range)
  }

  function handleCancel() {
    setDraft(value)
    setOpen(false)
  }

  function handleClear() {
    setDraft(undefined)
    setOpen(false)
    onChange(undefined)
  }

  function handleApply() {
    setOpen(false)
    onChange(draft)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="gap-1.5 px-2.5 font-normal text-foreground shadow-xs"
        >
          {formatRange(value)}
          <CalendarCog className="size-4 stroke-1 text-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-0">
        <Calendar
          mode="range"
          selected={draft}
          onSelect={handleSelect}
          numberOfMonths={2}
        />
        <div className="flex items-center justify-end gap-2 border-t p-2">
          <Button type="button" variant="ghost" size="sm" onClick={handleClear}>
            Clear
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!isDirty}
            onClick={handleApply}
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
