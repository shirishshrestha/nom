import { AddRuleForm } from "@/features/rules/components/add-rule-form"
import { RuleRow } from "@/features/rules/components/rule-row"
import {
  NEW_RULE_ID,
  useRules,
} from "@/features/rules/components/rules-context"
import type { Rule } from "@/features/rules/types"

export function RuleList({ rules }: { rules: Rule[] }) {
  const { openRuleId } = useRules()
  const isAdding = openRuleId === NEW_RULE_ID

  return (
    <div className="flex flex-col overflow-hidden rounded-md bg-white">
      {rules.length === 0 && !isAdding ? (
        <p className="px-5 py-10 text-center text-sm text-muted-foreground">
          No rules yet.
        </p>
      ) : (
        rules.map((rule, i) => (
          <RuleRow key={rule.id} rule={rule} index={i + 1} />
        ))
      )}
      {isAdding ? <AddRuleForm index={rules.length + 1} /> : null}
    </div>
  )
}
