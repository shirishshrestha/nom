import { organizationClient } from "better-auth/client/plugins"
import { createAuthClient } from "better-auth/react"
import { env } from "@/lib/env"

export const authClient = createAuthClient({
  /**
   * better-auth mounts its own routes (/api/auth) at the server root, not
   * under the REST /api/v1 prefix — so use the origin only, dropping the API
   * path.
   */
  baseURL: new URL(env.VITE_API_URL).origin,
  plugins: [organizationClient()],
})

export const {
  signIn,
  signUp,
  signOut,
  useSession,
  organization,
  useListOrganizations,
  useActiveOrganization,
  requestPasswordReset,
  resetPassword,
} = authClient
