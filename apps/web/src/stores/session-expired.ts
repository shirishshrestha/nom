import { create } from "zustand"

export const useSessionExpired = create<{
  expired: boolean
  open: () => void
  reset: () => void
}>((set) => ({
  expired: false,
  open: () => set({ expired: true }),
  reset: () => set({ expired: false }),
}))
