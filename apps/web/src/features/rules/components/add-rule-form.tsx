import { zodResolver } from "@hookform/resolvers/zod"
import { Button } from "@nom/ui/components/button"
import { Loader2 } from "lucide-react"
import { useForm } from "react-hook-form"
import { RuleFields } from "@/features/rules/components/rule-fields"
import { useRules } from "@/features/rules/components/rules-context"
import { RULE_CATEGORIES } from "@/features/rules/lib/rule-category"
import { type RuleFormData, ruleFormSchema } from "@/features/rules/schemas"

/** `index` is the 1-based position this rule will take once saved. */
export function AddRuleForm({ index }: { index: number }) {
  const { create, close, isCreating } = useRules()
  const {
    control,
    handleSubmit,
    formState: { isDirty },
  } = useForm<RuleFormData>({
    resolver: zodResolver(ruleFormSchema),
    defaultValues: { title: "", category: RULE_CATEGORIES[0], content: "" },
  })

  return (
    <form
      noValidate
      onSubmit={handleSubmit((data) => create(data))}
      className="flex flex-col gap-4 border-b border-gray-200 bg-muted px-6 py-3.5"
    >
      <span className="w-fit shrink-0 rounded-md bg-sidebar-accent px-1.5 py-0.5 font-mono text-xs leading-5 text-gray-500">
        {String(index).padStart(2, "0")}
      </span>
      <RuleFields control={control} />
      <div className="flex justify-end gap-3">
        <Button type="button" variant="ghost" onClick={close}>
          Discard
        </Button>
        <Button type="submit" disabled={isCreating || !isDirty}>
          {isCreating && <Loader2 className="size-4 animate-spin" />}
          Save
        </Button>
      </div>
    </form>
  )
}
