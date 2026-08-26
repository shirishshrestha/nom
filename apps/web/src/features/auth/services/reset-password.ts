import { useMutation } from "@tanstack/react-query"
import { resetPassword } from "@/lib/auth-client"

async function resetPasswordWithToken({
  newPassword,
  token,
}: {
  newPassword: string
  token: string
}) {
  const res = await resetPassword({ newPassword, token })
  if (res.error) throw res.error
}

export function useResetPasswordMutation() {
  return useMutation({ mutationFn: resetPasswordWithToken })
}
