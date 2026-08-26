import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@nom/ui/components/collapsible"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@nom/ui/components/dropdown-menu"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@nom/ui/components/sidebar"
import { useQuery } from "@tanstack/react-query"
import { Link, useRouterState } from "@tanstack/react-router"
import { ChevronRight, Package2 } from "lucide-react"
import { vendorsQuery } from "@/features/vendors/services/vendors"
import { SIDEBAR_ACTIVE_CLASS } from "./nav-main"

export function NavVendors() {
  const { data: vendors = [] } = useQuery(vendorsQuery)
  const { state, isMobile } = useSidebar()
  const collapsed = state === "collapsed" && !isMobile
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const isActiveVendor = (id: string) =>
    pathname === `/vendor/${id}` || pathname.startsWith(`/vendor/${id}/`)

  const byType = new Map<string, typeof vendors>()
  for (const vendor of vendors) {
    const type = vendor.type?.trim() || "Other"
    if (!byType.has(type)) byType.set(type, [])
    byType.get(type)!.push(vendor)
  }
  const groups = [...byType.entries()].sort(([a], [b]) => a.localeCompare(b))

  if (groups.length === 0) return null

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Vendors</SidebarGroupLabel>
      <SidebarMenu>
        {groups.map(([type, items]) =>
          collapsed ? (
            <SidebarMenuItem key={type}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton className="cursor-pointer">
                    <Package2 className="size-4" />
                    <span className="text-sm font-semibold">{type}</span>
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="right"
                  align="start"
                  className="min-w-44"
                >
                  <DropdownMenuLabel>{type}</DropdownMenuLabel>
                  {items.map((vendor) => (
                    <DropdownMenuItem
                      key={vendor.id}
                      className={SIDEBAR_ACTIVE_CLASS}
                      data-active={isActiveVendor(vendor.id) || undefined}
                      asChild
                    >
                      <Link
                        to="/vendor/$vendorId"
                        params={{ vendorId: vendor.id }}
                      >
                        {vendor.name}
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          ) : (
            <Collapsible
              key={type}
              asChild
              defaultOpen={items.some((v) => isActiveVendor(v.id))}
              className="group/collapsible"
            >
              <SidebarMenuItem>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton tooltip={type} className="cursor-pointer">
                    <Package2 className="size-4" />
                    <span className="text-sm font-semibold">{type}</span>
                    <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {items.map((vendor) => (
                      <SidebarMenuSubItem key={vendor.id}>
                        <SidebarMenuSubButton
                          className={`py-1 ${SIDEBAR_ACTIVE_CLASS}`}
                          isActive={isActiveVendor(vendor.id)}
                          asChild
                        >
                          <Link
                            to="/vendor/$vendorId"
                            params={{ vendorId: vendor.id }}
                          >
                            <span className="text-sm">{vendor.name}</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>
          )
        )}
      </SidebarMenu>
    </SidebarGroup>
  )
}
