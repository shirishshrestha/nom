import { create } from "zustand"

/**
 * Open-state for the rule delete confirm. `open` and `target` are separate so
 * close() doesn't clear target — otherwise the dialog's rule title would blank
 * out mid-close-animation. Mirrors useDeleteVendorDialog.
 */
export const useDeleteRuleDialog = create<{
  open: boolean
  target: { id: string; title: string } | null
  openFor: (target: { id: string; title: string }) => void
  close: () => void
}>((set) => ({
  open: false,
  target: null,
  openFor: (target) => set({ open: true, target }),
  close: () => set({ open: false }),
}))
