import { create } from "zustand"

/**
 * Payload is the vendorId (/source/discard is vendor-scoped). Open while
 * vendorId != null; close() resets.
 */
export const useDiscardReviewDialog = create<{
  vendorId: string | null
  openFor: (vendorId: string) => void
  close: () => void
}>((set) => ({
  vendorId: null,
  openFor: (vendorId) => set({ vendorId }),
  close: () => set({ vendorId: null }),
}))
