import { createFileRoute, redirect } from "@tanstack/react-router"
import { z } from "zod"
import { SignupForm } from "@/features/auth/components/signup-form"
import { sessionQuery } from "@/features/auth/services/session"
import { RouteSpinner } from "@/shared/components/route-spinner"

export const Route = createFileRoute("/(auth)/signup")({
  validateSearch: z.object({
    /** Internal paths only — see login.tsx. */
    redirect: z
      .string()
      .optional()
      .transform((v) => (v && /^\/(?!\/)/.test(v) ? v : undefined)),
  }),
  beforeLoad: async ({ context, search }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery)
    if (session?.user) throw redirect({ to: search.redirect ?? "/dashboard" })
  },
  pendingComponent: RouteSpinner,
  component: RouteComponent,
})

function RouteComponent() {
  const { redirect } = Route.useSearch()
  return <SignupForm redirect={redirect} />
}
