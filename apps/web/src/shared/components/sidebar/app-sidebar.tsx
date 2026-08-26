import { Invoice02Icon, ThreeDScaleIcon } from "@hugeicons/core-free-icons"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@nom/ui/components/sidebar"
import { Frame, GalleryVerticalEnd, Gauge, PieChart } from "lucide-react"
import type * as React from "react"
import { type NavItem, NavMain } from "./nav-main"
import { NavUser } from "./nav-user"
import { NavVendors } from "./nav-vendors"

const navPlatform: NavItem[] = [
  {
    title: "Dashboard",
    to: "/dashboard",
    icon: Gauge,
    activeMatch: (p) => p.startsWith("/dashboard"),
  },
  {
    title: "Vendor",
    to: "/vendor",
    icon: ThreeDScaleIcon,
    /** List + create highlight here; individual /vendor/$id defers to its sub-item. */
    activeMatch: (p) => p === "/vendor" || p.startsWith("/vendor/add"),
  },
  {
    title: "Invoice",
    to: "/invoice",
    icon: Invoice02Icon,
    activeMatch: (p) => p.startsWith("/invoice"),
  },
]

const navSystem: NavItem[] = [
  { title: "Audit Log", icon: Frame },
  { title: "Settings", icon: PieChart },
]

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="cursor-default">
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <GalleryVerticalEnd className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">Nomanbhoy</span>
                <span className="truncate text-xs">Reconciliation</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain label="Platform" items={navPlatform} />
        <NavVendors />
        <NavMain label="System" items={navSystem} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  )
}
