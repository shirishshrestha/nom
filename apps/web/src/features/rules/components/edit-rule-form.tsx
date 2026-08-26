import { zodResolver } from "@hookform/resolvers/zod"
import { Button } from "@nom/ui/components/button"
import { Loader2 } from "lucide-react"
import { useForm } from "react-hook-form"
import { RuleFields } from "@/features/rules/components/rule-fields"
import { useRules } from "@/features/rules/components/rules-context"
import { useDeleteRuleDialog } from "@/features/rules/store/delete-rule-dialog"
import { type RuleFormData, ruleFormSchema } from "@/features/rules/schemas"
import type { Rule } from "@/features/rules/types"
import { HugeiconsIcon } from "@hugeicons/react"
import { Delete01Icon } from "@hugeicons/core-free-icons"

export function EditRuleForm({ rule }: { rule: Rule }) {
  const { update, close, isUpdating } = useRules()
  const openDeleteDialog = useDeleteRuleDialog((s) => s.openFor)
  const {
    control,
    handleSubmit,
    formState: { isDirty },
  } = useForm<RuleFormData>({
    resolver: zodResolver(ruleFormSchema),
    defaultValues: {
      title: rule.title,
      category: rule.category,
      content: rule.content,
    },
  })

  return (
    <form
      noValidate
      onSubmit={handleSubmit((data) => update(rule.id, data))}
      className="flex flex-col gap-4 bg-muted px-6 py-3.5"
    >
      <RuleFields control={control} />
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          className="gap-3 px-0 text-red-600 hover:text-red-600"
          onClick={() => openDeleteDialog({ id: rule.id, title: rule.title })}
        >
          <HugeiconsIcon icon={Delete01Icon} className="size-4" />
          Delete
        </Button>
        <div className="flex gap-3">
          <Button type="button" variant="ghost" onClick={close}>
            Discard
          </Button>
          <Button type="submit" disabled={isUpdating || !isDirty}>
            {isUpdating && <Loader2 className="size-4 animate-spin" />}
            Save
          </Button>
        </div>
      </div>
    </form>
  )
}
