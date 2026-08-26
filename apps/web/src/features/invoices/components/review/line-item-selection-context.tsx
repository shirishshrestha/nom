import { toast } from "@nom/ui/components/sonner"
import { createContext, type ReactNode, use, useState } from "react"
import {
  useAcceptLineItemMutation,
  useGuidanceMutation,
} from "@/features/invoices/services/invoice-review"
import type { LineItem } from "@/features/invoices/types"

type LineItemSelectionValue = {
  selected: LineItem | null
  hasPrev: boolean
  hasNext: boolean
  select: (id: string) => void
  prev: () => void
  next: () => void
  close: () => void
  saveGuidance: (text: string) => void
  isSavingNote: boolean
  accept: () => void
  isAccepting: boolean
}

const LineItemSelectionContext = createContext<LineItemSelectionValue | null>(
  null
)

export function useLineItemSelection(): LineItemSelectionValue {
  const ctx = use(LineItemSelectionContext)
  if (!ctx)
    throw new Error(
      "useLineItemSelection must be used within <LineItemSelectionProvider>"
    )
  return ctx
}

/**
 * Owns which line item is open in the detail sheet plus its guidance/accept
 * mutations, so the table (which sets the selection) and the sheet (which reads
 * and navigates it) share state without prop-drilling through the layout.
 * Navigation runs over the already filtered/sorted `lineItems` the table shows;
 * a selection that filtering drops out of the list resolves to null (sheet closes).
 */
export function LineItemSelectionProvider({
  documentId,
  lineItems,
  children,
}: {
  documentId: string
  lineItems: LineItem[]
  children: ReactNode
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const guidance = useGuidanceMutation()
  const acceptMutation = useAcceptLineItemMutation()

  const index = lineItems.findIndex((l) => l.id === selectedId)
  const selected = index >= 0 ? lineItems[index] : null

  const saveGuidance = (text: string) => {
    if (!selected) return
    guidance.mutate(
      { documentId, lineItemId: selected.id, guidance: text },
      { onSuccess: () => toast.success("Guidance saved") }
    )
  }

  const accept = () => {
    if (!selected) return
    acceptMutation.mutate(
      { documentId, lineItemId: selected.id },
      { onSuccess: () => toast.success("Discrepancy accepted") }
    )
  }

  const value: LineItemSelectionValue = {
    selected,
    hasPrev: index > 0,
    hasNext: index >= 0 && index < lineItems.length - 1,
    select: setSelectedId,
    prev: () => setSelectedId(lineItems[index - 1]?.id ?? null),
    next: () => setSelectedId(lineItems[index + 1]?.id ?? null),
    close: () => setSelectedId(null),
    saveGuidance,
    isSavingNote: guidance.isPending,
    accept,
    isAccepting: acceptMutation.isPending,
  }

  return (
    <LineItemSelectionContext value={value}>
      {children}
    </LineItemSelectionContext>
  )
}
