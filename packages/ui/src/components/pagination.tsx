import { Button } from "@nom/ui/components/button"
import { Field, FieldLabel } from "@nom/ui/components/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nom/ui/components/select"
import { cn } from "@nom/ui/lib/utils"
import { MoreHorizontal } from "lucide-react"
import type * as React from "react"

// shadcn-style pagination primitives, adapted from unified-inbox to this
// project's Button/Field/Select. Pair with buildPageItems for the page list.
function Pagination({ className, ...props }: React.ComponentProps<"nav">) {
  return (
    <nav
      aria-label="pagination"
      data-slot="pagination"
      className={cn("flex w-full items-center", className)}
      {...props}
    />
  )
}

function PaginationContent({
  className,
  ...props
}: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="pagination-content"
      className={cn("flex items-center gap-1", className)}
      {...props}
    />
  )
}

function PaginationItem({ ...props }: React.ComponentProps<"li">) {
  return <li data-slot="pagination-item" {...props} />
}

type PaginationLinkProps = {
  isActive?: boolean
} & React.ComponentProps<typeof Button>

function PaginationLink({ isActive, ...props }: PaginationLinkProps) {
  return (
    <Button
      type="button"
      data-slot="pagination-link"
      aria-current={isActive ? "page" : undefined}
      variant={isActive ? "default" : "ghost"}
      size="icon-sm"
      {...props}
    />
  )
}

function PaginationPrevious({
  text = "Previous",
  ...props
}: React.ComponentProps<typeof Button> & { text?: string }) {
  return (
    <Button
      type="button"
      data-slot="pagination-previous"
      variant="ghost"
      size="sm"
      aria-label="Go to previous page"
      {...props}
    >
      <span className="hidden sm:block">{text}</span>
    </Button>
  )
}

function PaginationNext({
  text = "Next",
  ...props
}: React.ComponentProps<typeof Button> & { text?: string }) {
  return (
    <Button
      type="button"
      data-slot="pagination-next"
      variant="ghost"
      size="sm"
      aria-label="Go to next page"
      {...props}
    >
      <span className="hidden sm:block">{text}</span>
    </Button>
  )
}

function PaginationEllipsis({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      aria-hidden
      data-slot="pagination-ellipsis"
      className={cn(
        "flex size-8 items-center justify-center text-muted-foreground",
        className
      )}
      {...props}
    >
      <MoreHorizontal className="size-4" />
      <span className="sr-only">More pages</span>
    </span>
  )
}

function PaginationPageSize({
  value,
  options = [10, 20, 50],
  onChange,
  className,
}: {
  value: number
  options?: number[]
  onChange: (size: number) => void
  className?: string
}) {
  const id = "pagination-rows-per-page"
  return (
    <Field
      orientation="horizontal"
      data-slot="pagination-page-size"
      className={cn("w-fit items-center gap-2", className)}
    >
      <FieldLabel htmlFor={id} className="mb-0 text-xs text-muted-foreground">
        Rows per page
      </FieldLabel>
      <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger id={id} size="sm" className="h-8 w-16 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="start">
          <SelectGroup>
            {options.map((opt) => (
              <SelectItem key={opt} value={String(opt)}>
                {opt}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  )
}

export {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPageSize,
  PaginationPrevious,
}
export type { PaginationLinkProps }
