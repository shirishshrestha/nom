import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@nom/ui/components/collapsible"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@nom/ui/components/sidebar"
import { Link, type LinkProps, useRouterState } from "@tanstack/react-router"
import { ChevronRight, type LucideIcon } from "lucide-react"

type NavIcon = LucideIcon | IconSvgElement

export type NavItem = {
  title: string
  to?: LinkProps["to"]
  icon?: NavIcon
  isActive?: boolean
  activeMatch?: (pathname: string) => boolean
  items?: { title: string; to?: LinkProps["to"] }[]
}

export const SIDEBAR_ACTIVE_CLASS =
  "data-active:bg-blue-100 data-active:hover:bg-blue-100 data-active:text-foreground"

function SidebarIcon({
  icon,
  className,
}: {
  icon: NavIcon
  className?: string
}) {
  if (Array.isArray(icon)) {
    return (
      <HugeiconsIcon
        icon={icon}
        size={16}
        strokeWidth={1.75}
        className={className}
      />
    )
  }

  const Icon = icon as LucideIcon
  return <Icon className={className} />
}

export function NavMain({ label, items }: { label: string; items: NavItem[] }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) =>
          item.items?.length ? (
            <Collapsible
              key={item.title}
              asChild
              defaultOpen={item.isActive}
              className="group/collapsible"
            >
              <SidebarMenuItem>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton tooltip={item.title}>
                    {item.icon && (
                      <SidebarIcon icon={item.icon} className="size-4" />
                    )}
                    <span className="text-sm font-semibold">{item.title}</span>
                    <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {item.items.map((sub) => (
                      <SidebarMenuSubItem key={sub.title}>
                        {sub.to ? (
                          <SidebarMenuSubButton className="py-1" asChild>
                            <Link to={sub.to}>
                              <span className="text-sm">{sub.title}</span>
                            </Link>
                          </SidebarMenuSubButton>
                        ) : (
                          <SidebarMenuSubButton className="py-1">
                            <span className="text-sm">{sub.title}</span>
                          </SidebarMenuSubButton>
                        )}
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>
          ) : item.to ? (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                asChild
                tooltip={item.title}
                isActive={item.activeMatch?.(pathname) ?? pathname === item.to}
                className={SIDEBAR_ACTIVE_CLASS}
              >
                <Link to={item.to}>
                  {item.icon && (
                    <SidebarIcon icon={item.icon} className="size-4" />
                  )}
                  <span className="text-sm font-semibold">{item.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton tooltip={item.title}>
                {item.icon && (
                  <SidebarIcon icon={item.icon} className="size-4" />
                )}
                <span className="text-sm font-semibold">{item.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )
        )}
      </SidebarMenu>
    </SidebarGroup>
  )
}
