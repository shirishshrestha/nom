import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@nom/ui/components/collapsible"
import { cn } from "@nom/ui/lib/utils"
import dayjs from "dayjs"
import { EditRuleForm } from "@/features/rules/components/edit-rule-form"
import { useRules } from "@/features/rules/components/rules-context"
import type { Rule } from "@/features/rules/types"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowRight01Icon } from "@hugeicons/core-free-icons"

/** `index` is the 1-based display position (rendered as 01, 02, …). */
export function RuleRow({ rule, index }: { rule: Rule; index: number }) {
  const { openRuleId, open, close } = useRules()
  const isOpen = openRuleId === rule.id

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={(next) => (next ? open(rule.id) : close())}
      className="border-b border-gray-100"
    >
      <CollapsibleTrigger
        className={cn(
          "group flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-muted",
          isOpen && "bg-muted"
        )}
      >
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90"
        />
        <span className="shrink-0 rounded-md bg-sidebar-accent px-1.5 py-0.5 font-mono text-xs leading-5 text-gray-500">
          {String(index).padStart(2, "0")}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-black">
            {rule.title}
          </p>
          <p className="truncate font-mono text-xs text-gray-600">
            {rule.content}
          </p>
        </div>
        <span className="shrink-0 text-sm font-medium text-gray-400">
          {dayjs(rule.createdAt).format("DD MMMM YYYY")}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <EditRuleForm rule={rule} />
      </CollapsibleContent>
    </Collapsible>
  )
}
