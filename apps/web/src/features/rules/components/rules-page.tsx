import { Button } from "@nom/ui/components/button"
import { ButtonGroup } from "@nom/ui/components/button-group"
import { Input } from "@nom/ui/components/input"
import { toast } from "@nom/ui/components/sonner"
import { useQuery } from "@tanstack/react-query"
import { Loader2, Plus, Search } from "lucide-react"
import { useState } from "react"
import { DeleteRuleDialog } from "@/features/rules/components/delete-rule-dialog"
import { RuleList } from "@/features/rules/components/rule-list"
import {
  NEW_RULE_ID,
  RulesProvider,
  useRules,
} from "@/features/rules/components/rules-context"
import { rulesQuery, useDeleteRule } from "@/features/rules/services/rules"
import { useDeleteRuleDialog } from "@/features/rules/store/delete-rule-dialog"
import { useDebouncedValue } from "@/shared/hooks/use-debounced-value"

export function RulesPage({ vendorId }: { vendorId: string }) {
  return (
    <RulesProvider vendorId={vendorId}>
      <RulesLayout />
    </RulesProvider>
  )
}

function RulesLayout() {
  const { vendorId, open } = useRules()
  const confirmDelete = useDeleteRuleDialog()
  const remove = useDeleteRule(vendorId)
  const [searchTerm, setSearchTerm] = useState("")
  const search = useDebouncedValue(searchTerm.trim(), 300)
  const { data: rules = [], isLoading } = useQuery(
    rulesQuery(vendorId, search || undefined)
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pt-2 pb-6">
      <div className="flex items-center gap-4 px-6 pb-2">
        <div className="flex flex-1 items-center gap-2">
          <h2 className="text-base font-semibold">Rule</h2>
          <span className="text-base font-semibold text-muted-foreground">
            {rules.length}
          </span>
        </div>
        <ButtonGroup className="border-border shadow-xs">
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search..."
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
        <Button onClick={() => open(NEW_RULE_ID)}>
          <Plus className="size-4" />
          Add Rule
        </Button>
      </div>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center gap-2 rounded-md bg-white text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading rules…
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto bg-white">
          <RuleList rules={rules} />
        </div>
      )}

      <DeleteRuleDialog
        open={confirmDelete.open}
        ruleTitle={confirmDelete.target?.title}
        isDeleting={remove.isPending}
        onOpenChange={(next) => {
          if (!next) confirmDelete.close()
        }}
        onCancel={confirmDelete.close}
        onConfirm={() => {
          if (!confirmDelete.target) return
          remove.mutate(confirmDelete.target.id, {
            onSuccess: () => {
              toast.success("Rule deleted")
              confirmDelete.close()
            },
          })
        }}
      />
    </div>
  )
}
