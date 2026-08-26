import { Button } from "@nom/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nom/ui/components/dialog"
import { useLocation } from "@tanstack/react-router"
import { useSessionExpired } from "@/stores/session-expired"

/**
 * Mounted once at the root. Opens when the axios 401 interceptor flips the
 * session-expired store (in-page data call hit an expired session). Navigation-
 * time 401s are handled by route guards, so this only covers the sitting-on-a-
 * page case. Non-dismissable: only "Log in" acts.
 */
export function SessionExpiredDialog() {
  const expired = useSessionExpired((s) => s.expired)
  const reset = useSessionExpired((s) => s.reset)
  const location = useLocation()

  function onLogin() {
    const current = location.href
    const url =
      current && current !== "/"
        ? `/login?redirect=${encodeURIComponent(current)}`
        : "/login"
    reset()
    window.location.replace(url)
  }

  return (
    <Dialog open={expired}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Session expired</DialogTitle>
        </DialogHeader>
        <DialogDescription>
          Your session has expired. Please log in again to continue.
        </DialogDescription>
        <DialogFooter>
          <Button onClick={onLogin}>Log in</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
