import { toast } from "@nom/ui/components/sonner"
import {
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"
import type { RuleFormData } from "@/features/rules/schemas"
import type { Rule } from "@/features/rules/types"
import { api } from "@/lib/api"
import { getErrorMessage } from "@/lib/errors"

/** All of a vendor's rules queries share this prefix (any search variant). */
const rulesPrefix = (vendorId: string) =>
  ["vendors", vendorId, "rules"] as const

export const rulesQuery = (vendorId: string, search?: string) =>
  queryOptions({
    queryKey: [...rulesPrefix(vendorId), search ?? ""] as const,
    queryFn: async () => {
      const res = await api.get<{ data: Rule[] }>(
        `/vendors/${vendorId}/rules`,
        search ? { params: { search } } : undefined
      )
      return res.data.data
    },
  })

async function createRule(vendorId: string, data: RuleFormData) {
  const res = await api.post<{ data: Rule }>(`/vendors/${vendorId}/rules`, data)
  return res.data.data
}

export function useCreateRule(vendorId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: RuleFormData) => createRule(vendorId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: rulesPrefix(vendorId) }),
    onError: (error) =>
      toast.error(getErrorMessage(error, "Failed to create rule")),
  })
}

async function updateRule(vendorId: string, id: string, data: RuleFormData) {
  const res = await api.patch<{ data: Rule }>(
    `/vendors/${vendorId}/rules/${id}`,
    data
  )
  return res.data.data
}

export function useUpdateRule(vendorId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: RuleFormData }) =>
      updateRule(vendorId, id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: rulesPrefix(vendorId) }),
    onError: (error) =>
      toast.error(getErrorMessage(error, "Failed to update rule")),
  })
}

function deleteRule(vendorId: string, id: string) {
  return api.delete(`/vendors/${vendorId}/rules/${id}`)
}

export function useDeleteRule(vendorId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteRule(vendorId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: rulesPrefix(vendorId) }),
    onError: (error) =>
      toast.error(getErrorMessage(error, "Failed to delete rule")),
  })
}
