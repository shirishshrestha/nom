import { useMutation } from "@tanstack/react-query"
import { signOut } from "@/lib/auth-client"

function logout() {
  return signOut()
}

export function useLogoutMutation() {
  return useMutation({ mutationFn: logout })
}
