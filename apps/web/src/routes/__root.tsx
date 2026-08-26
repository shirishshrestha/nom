import { Toaster } from "@nom/ui/components/sonner"
import type { QueryClient } from "@tanstack/react-query"
import { QueryClientProvider } from "@tanstack/react-query"
import { ReactQueryDevtools } from "@tanstack/react-query-devtools"
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router"
import { TanStackRouterDevtools } from "@tanstack/router-devtools"
import { SessionExpiredDialog } from "@/features/auth/components/session-expired-dialog"
import { queryClient } from "@/lib/query-client"

/**
 * Context typing lets every loader/guard reach context.queryClient (and auth,
 * etc. if you add them). The actual values are passed in main.tsx.
 */
export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    component: () => (
      <QueryClientProvider client={queryClient}>
        <Outlet />
        <Toaster />
        <SessionExpiredDialog />
        {import.meta.env.DEV && (
          <>
            <ReactQueryDevtools buttonPosition="bottom-left" />
            <TanStackRouterDevtools position="bottom-right" />
          </>
        )}
      </QueryClientProvider>
    ),
  }
)
