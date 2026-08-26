import { toast } from "@nom/ui/components/sonner"
import { createContext, type ReactNode, use, useState } from "react"
import { useCreateRule, useUpdateRule } from "@/features/rules/services/rules"
import type { RuleFormData } from "@/features/rules/schemas"

/** Sentinel `openRuleId` for the unsaved "Add rule" editor. */
export const NEW_RULE_ID = "__new__"

type RulesContextValue = {
  vendorId: string
  openRuleId: string | null
  isCreating: boolean
  isUpdating: boolean
  open: (id: string) => void
  close: () => void
  create: (data: RuleFormData) => void
  update: (id: string, data: RuleFormData) => void
}

const RulesContext = createContext<RulesContextValue | null>(null)

export function useRules(): RulesContextValue {
  const ctx = use(RulesContext)
  if (!ctx) throw new Error("useRules must be used within <RulesProvider>")
  return ctx
}

/**
 * Owns which rule is open in the accordion plus the create/update mutations,
 * so the header's "Add Rule", each row, and the inline form all share state
 * without prop-drilling. One row open at a time (`openRuleId`). Each action
 * closes the editor itself on success; error toasts live in the mutation hooks.
 */
export function RulesProvider({
  vendorId,
  children,
}: {
  vendorId: string
  children: ReactNode
}) {
  const [openRuleId, setOpenRuleId] = useState<string | null>(null)
  const createMutation = useCreateRule(vendorId)
  const updateMutation = useUpdateRule(vendorId)
  const close = () => setOpenRuleId(null)

  const value: RulesContextValue = {
    vendorId,
    openRuleId,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    open: setOpenRuleId,
    close,
    create: (data) =>
      createMutation.mutate(data, {
        onSuccess: () => {
          toast.success("Rule created")
          close()
        },
      }),
    update: (id, data) =>
      updateMutation.mutate(
        { id, data },
        {
          onSuccess: () => {
            toast.success("Rule updated")
            close()
          },
        }
      ),
  }

  return <RulesContext value={value}>{children}</RulesContext>
}
