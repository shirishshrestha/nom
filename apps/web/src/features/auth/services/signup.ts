import { useMutation, useQueryClient } from "@tanstack/react-query"
import { baseSessionQueryKey } from "@/features/auth/services/session"
import { organization, signUp } from "@/lib/auth-client"

type SignupPayload = { name: string; email: string; password: string }

async function signupWithOrg({ name, email, password }: SignupPayload) {
  const res = await signUp.email({ name, email, password })
  if (res.error) throw res.error
  /** Sign-up auto-signs-in, so we have a session: create the user's default org. */
  const slug = `${
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "org"
  }-${crypto.randomUUID().slice(0, 8)}`
  const orgRes = await organization.create({ name, slug })
  if (orgRes.error) throw orgRes.error
}

export function useSignupMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: signupWithOrg,
    onSuccess: () => qc.removeQueries({ queryKey: baseSessionQueryKey }),
  })
}
