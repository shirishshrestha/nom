import type { RuleCategory } from "@/features/rules/lib/rule-category"

/** Local mirror of RuleDto (packages/dtos/src/rules/rule.dto.ts). */
export type Rule = {
  id: string
  title: string
  category: RuleCategory
  content: string
  createdAt: string
  updatedAt: string
}
