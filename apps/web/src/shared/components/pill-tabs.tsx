import { Tabs, TabsList, TabsTrigger } from "@nom/ui/components/tabs"
import { cn } from "@nom/ui/lib/utils"
import type { ComponentProps } from "react"

export { Tabs }

export function PillTabsList({
  className,
  ...props
}: ComponentProps<typeof TabsList>) {
  return (
    <TabsList
      className={cn(
        "h-auto justify-start gap-1 rounded-sm bg-gray-100 p-0 px-1.5 py-1 group-data-horizontal/tabs:h-auto",
        className
      )}
      {...props}
    />
  )
}

export function PillTabsTrigger({
  className,
  ...props
}: ComponentProps<typeof TabsTrigger>) {
  return (
    <TabsTrigger
      className={cn(
        "h-auto flex-none cursor-pointer gap-1 rounded-sm border-none px-2 py-0.5 text-sm font-normal text-ring",
        "data-[state=active]:bg-gray-500 data-[state=active]:text-white dark:data-[state=active]:bg-gray-500",
        className
      )}
      {...props}
    />
  )
}
