import { FileEmpty02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { cn } from "@nom/ui/lib/utils"

/** Shown in place of the cards/split panels when a file has zero remaining services. */
export function NoServicesState({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-md border bg-white p-8 text-center",
        className
      )}
    >
      <HugeiconsIcon
        icon={FileEmpty02Icon}
        strokeWidth={1}
        className="size-16 text-foreground"
      />
      <p className="text-xl font-semibold text-foreground">
        No quotations to review
      </p>
      <p className="max-w-64 text-sm leading-5 text-foreground">
        Every quotation was removed, or none were extracted from this file.
      </p>
    </div>
  )
}
