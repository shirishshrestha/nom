import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@nom/ui/components/breadcrumb"
import { Separator } from "@nom/ui/components/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@nom/ui/components/sidebar"
import { TooltipProvider } from "@nom/ui/components/tooltip"
import {
  createFileRoute,
  Link,
  type LinkProps,
  Outlet,
  redirect,
  useMatches,
} from "@tanstack/react-router"
import type * as React from "react"
import { sessionQuery } from "@/features/auth/services/session"
import { RouteSpinner } from "@/shared/components/route-spinner"
import { AppSidebar } from "@/shared/components/sidebar/app-sidebar"

/** Each route sets its own breadcrumb + header actions via staticData. */
declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    title?: string
    breadcrumb?: string
    breadcrumbParent?: { label: string; to: LinkProps["to"] }
    PageActions?: React.ComponentType
  }
}

/** Pathless layout — guards everything nested under it and renders the shell. */
export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ context, location }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery)
    if (!session?.user) {
      throw redirect({ to: "/login", search: { redirect: location.href } })
    }
  },
  pendingComponent: RouteSpinner,
  component: AppLayout,
})

function AppLayout() {
  const matches = useMatches()
  const lastMatch = matches.at(-1)
  const active = lastMatch?.staticData ?? {}
  const breadcrumb = active.breadcrumb ?? "Dashboard"
  const loaderData = lastMatch?.loaderData as { pageTitle?: string } | undefined
  const title = loaderData?.pageTitle ?? active.title ?? breadcrumb
  const PageActions = active.PageActions

  return (
    <TooltipProvider delayDuration={0}>
      <SidebarProvider className="h-svh overflow-hidden">
        <AppSidebar />
        <SidebarInset className="min-w-0">
          <header className="sticky top-0 flex h-16 shrink-0 items-center justify-between gap-2 border-b border-border bg-background px-4 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="size-7" />
              <div className="h-4.25">
                <Separator
                  orientation="vertical"
                  className="mx-2 h-4.25 py-2"
                />
              </div>
              <span className="text-base font-semibold">{title}</span>
              <div className="h-4.25">
                <Separator
                  orientation="vertical"
                  className="mx-2 h-4.25 py-2"
                />
              </div>
              <Breadcrumb className="">
                <BreadcrumbList>
                  <BreadcrumbItem>
                    <BreadcrumbLink asChild>
                      <Link to="/dashboard">Home</Link>
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                  {active.breadcrumbParent ? (
                    <>
                      <BreadcrumbItem>
                        <BreadcrumbLink asChild>
                          <Link to={active.breadcrumbParent.to} params={true}>
                            {active.breadcrumbParent.label}
                          </Link>
                        </BreadcrumbLink>
                      </BreadcrumbItem>
                      <BreadcrumbSeparator />
                    </>
                  ) : null}
                  <BreadcrumbItem>
                    <BreadcrumbPage>{breadcrumb}</BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            </div>
            {PageActions && <PageActions />}
          </header>
          <Outlet />
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
