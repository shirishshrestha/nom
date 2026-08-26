import { createFileRoute, redirect } from "@tanstack/react-router"
import { ForgotPasswordForm } from "@/features/auth/components/forgot-password-form"
import { sessionQuery } from "@/features/auth/services/session"
import { RouteSpinner } from "@/shared/components/route-spinner"

export const Route = createFileRoute("/(auth)/forgot-password")({
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery)
    if (session?.user) throw redirect({ to: "/dashboard" })
  },
  pendingComponent: RouteSpinner,
  component: ForgotPasswordForm,
})
