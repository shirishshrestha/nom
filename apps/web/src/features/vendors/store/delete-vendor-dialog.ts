import { create } from "zustand"

/**
 * Open-state for the vendor delete confirm. `open` and `target` are separate
 * so close() doesn't clear target — otherwise the dialog's vendor name would
 * blank out mid-close-animation. openFor always sets a fresh target, so a
 * stale one never leaks into the next open. Mirrors ConfirmDeleteServiceDialog.
 */
export const useDeleteVendorDialog = create<{
  open: boolean
  target: { id: string; name: string } | null
  openFor: (target: { id: string; name: string }) => void
  close: () => void
}>((set) => ({
  open: false,
  target: null,
  openFor: (target) => set({ open: true, target }),
  close: () => set({ open: false }),
}))
