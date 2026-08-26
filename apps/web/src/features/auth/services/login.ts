import { useMutation, useQueryClient } from "@tanstack/react-query"
import { baseSessionQueryKey } from "@/features/auth/services/session"
import { organization, signIn } from "@/lib/auth-client"

type LoginPayload = { email: string; password: string }

async function login(data: LoginPayload) {
  const res = await signIn.email(data)
  if (res.error) throw res.error
  /** better-auth mints a fresh session on login with no active org; set the user's first. */
  const { data: orgs } = await organization.list()
  if (orgs?.length) {
    await organization.setActive({ organizationId: orgs[0].id })
  }
}

export function useLoginMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: login,
    onSuccess: () => qc.removeQueries({ queryKey: baseSessionQueryKey }),
  })
}
