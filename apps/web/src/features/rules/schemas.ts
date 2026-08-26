import { z } from "zod"
import { RULE_CATEGORIES } from "@/features/rules/lib/rule-category"

export const ruleFormSchema = z.object({
  title: z.string().trim().min(1, "Rule title is required."),
  category: z.enum(RULE_CATEGORIES),
  content: z.string().trim().min(1, "Rule content is required."),
})

export type RuleFormData = z.infer<typeof ruleFormSchema>
