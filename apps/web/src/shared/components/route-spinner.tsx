import { Loader2 } from "lucide-react"

/**
 * Shown as TanStack Router `pendingComponent` while a route's beforeLoad
 * (session fetch) resolves on cold load — avoids a blank screen.
 */
export function RouteSpinner() {
  return (
    <div className="flex min-h-svh items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  )
}
