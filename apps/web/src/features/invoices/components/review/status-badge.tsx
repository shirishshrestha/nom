import {
  Alert02Icon,
  MultiplicationSignSquareFreeIcons,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Badge } from "@nom/ui/components/badge"
import { cn } from "@nom/ui/lib/utils"
import { Check, CheckCircle2, Loader2 } from "lucide-react"
import type { ReactNode } from "react"
import {
  type DisplayStatus,
  STATUS_CHIP,
} from "@/features/invoices/lib/line-item-status"

/** The two icon sets have different call shapes, so this holds finished nodes rather
 *  than components. Hoisted because they are static. */
const ICON = {
  match: <Check className="size-4" />,
  mismatch: (
    <HugeiconsIcon
      icon={MultiplicationSignSquareFreeIcons}
      className="size-4"
    />
  ),
  needs_review: <HugeiconsIcon icon={Alert02Icon} className="size-4" />,
  accepted: <CheckCircle2 className="size-4" />,
  processing: <Loader2 className="size-3.5 animate-spin" />,
  pending: null,
} satisfies Record<DisplayStatus, ReactNode>

export function StatusBadge({ status }: { status: DisplayStatus }) {
  const { label, className } = STATUS_CHIP[status]
  return (
    <Badge
      variant="outline"
      className={cn(
        "justify-start gap-1 rounded-none border-transparent px-0.5 py-px",
        className
      )}
    >
      {ICON[status]}
      {label}
    </Badge>
  )
}
