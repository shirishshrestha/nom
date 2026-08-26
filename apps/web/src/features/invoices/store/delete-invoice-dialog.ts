import { create } from "zustand"

/**
 * Open-state for the invoice delete confirm. `open` and `target` are separate
 * so close() doesn't clear target — otherwise the dialog's file name would
 * blank out mid-close-animation. openFor always sets a fresh target, so a
 * stale one never leaks into the next open. Mirrors delete-vendor-dialog.ts.
 */
export const useDeleteInvoiceDialog = create<{
  open: boolean
  target: { documentId: string; fileName: string } | null
  openFor: (target: { documentId: string; fileName: string }) => void
  close: () => void
}>((set) => ({
  open: false,
  target: null,
  openFor: (target) => set({ open: true, target }),
  close: () => set({ open: false }),
}))
