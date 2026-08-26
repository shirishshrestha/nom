import { Button } from "@nom/ui/components/button"
import {
  PaginationEllipsis,
  PaginationPageSize,
} from "@nom/ui/components/pagination"
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react"
import { buildPageItems, isEllipsis } from "@/shared/lib/pagination"

export function DataTablePagination({
  total,
  page,
  pageCount,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  total: number
  page: number
  pageCount: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}) {
  // 10 is PaginationPageSize's smallest rows-per-page option — below that, no
  // page-size choice would ever produce more than one page, so there's
  // nothing to offer. Keying off `total` (not `pageCount`) means the
  // rows-per-page picker never disappears just because the user picked a
  // large page size for a small result set.
  if (total <= 10) return null

  const atStart = page <= 1
  const atEnd = page >= pageCount

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <PaginationPageSize value={pageSize} onChange={onPageSizeChange} />

      {pageCount > 1 ? (
        <div className="flex items-center gap-1.5">
          <NavButton
            label="Go to first page"
            disabled={atStart}
            onClick={() => onPageChange(1)}
          >
            <ChevronsLeft className="size-4" />
          </NavButton>
          <NavButton
            label="Go to previous page"
            disabled={atStart}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeft className="size-4" />
          </NavButton>

          {buildPageItems(page, pageCount).map((item) =>
            isEllipsis(item) ? (
              <PaginationEllipsis key={item} />
            ) : (
              <Button
                key={item}
                type="button"
                variant={item === page ? "default" : "outline"}
                size="icon-sm"
                aria-current={item === page ? "page" : undefined}
                onClick={() => onPageChange(item)}
              >
                {item}
              </Button>
            )
          )}

          <NavButton
            label="Go to next page"
            disabled={atEnd}
            onClick={() => onPageChange(page + 1)}
          >
            <ChevronRight className="size-4" />
          </NavButton>
          <NavButton
            label="Go to last page"
            disabled={atEnd}
            onClick={() => onPageChange(pageCount)}
          >
            <ChevronsRight className="size-4" />
          </NavButton>
        </div>
      ) : null}
    </div>
  )
}

function NavButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}
