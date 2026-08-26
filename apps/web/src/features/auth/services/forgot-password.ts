import { useMutation } from "@tanstack/react-query"
import { requestPasswordReset } from "@/lib/auth-client"

async function forgotPassword({ email }: { email: string }) {
  const res = await requestPasswordReset({
    email,
    redirectTo: `${window.location.origin}/reset-password`,
  })
  if (res.error) throw res.error
}

export function useForgotPasswordMutation() {
  return useMutation({ mutationFn: forgotPassword })
}
