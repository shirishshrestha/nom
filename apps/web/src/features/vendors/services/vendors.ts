import { toast } from "@nom/ui/components/sonner"
import {
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"
import type { CreateVendorFormData, Vendor } from "@/features/vendors/schemas"
import { api } from "@/lib/api"
import { getErrorMessage } from "@/lib/errors"

const baseVendorQueryKey = ["vendors"] as const

/** API wraps payloads in { success, data, message, status } — unwrap to data. */
export const vendorsQuery = queryOptions({
  queryKey: baseVendorQueryKey,
  queryFn: async () => {
    const res = await api.get<{ data: Vendor[] }>("/vendors")
    return res.data.data
  },
})

export const vendorQuery = (id: string) =>
  queryOptions({
    queryKey: [...baseVendorQueryKey, id],
    queryFn: async () => {
      const res = await api.get<{ data: Vendor }>(`/vendors/${id}`)
      return res.data.data
    },
  })

export const vendorTypesQuery = queryOptions({
  queryKey: [...baseVendorQueryKey, "types"],
  queryFn: async () => {
    const res = await api.get<{ data: string[] }>("/vendors/types")
    return res.data.data
  },
})

async function createVendor(data: CreateVendorFormData) {
  const res = await api.post<{ data: Vendor }>("/vendors", data)
  return res.data.data
}

export function useCreateVendorMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createVendor,
    onSuccess: () => qc.invalidateQueries({ queryKey: baseVendorQueryKey }),
  })
}

async function updateVendor(id: string, data: CreateVendorFormData) {
  const res = await api.patch<{ data: Vendor }>(`/vendors/${id}`, data)
  return res.data.data
}

export function useUpdateVendorMutation(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateVendorFormData) => updateVendor(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: baseVendorQueryKey }),
  })
}

function deleteVendor(id: string) {
  return api.delete(`/vendors/${id}`)
}

export function useDeleteVendorMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteVendor,
    onSuccess: () => qc.invalidateQueries({ queryKey: baseVendorQueryKey }),
    onError: (error) =>
      toast.error(getErrorMessage(error, "Failed to delete vendor")),
  })
}
