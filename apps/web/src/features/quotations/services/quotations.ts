import { keepPreviousData, queryOptions } from "@tanstack/react-query"
import { mapGroupedServicesToQuotations } from "@/features/quotations/mappers/quotations-mappers"
import type {
  CurrentServicesResult,
  QuotationFilters,
} from "@/features/quotations/types"
import { api } from "@/lib/api"

export const vendorQuotationsBaseKey = (vendorId: string) =>
  ["vendors", vendorId, "quotations"] as const

const vendorQuotationsKey = (
  vendorId: string,
  page: number,
  pageSize: number,
  filters: QuotationFilters
) =>
  [...vendorQuotationsBaseKey(vendorId), { page, pageSize, filters }] as const

/** API wraps payloads in { success, data, message, status } — unwrap to data. */
async function getVendorQuotations(
  vendorId: string,
  page: number,
  pageSize: number,
  filters: QuotationFilters
) {
  const res = await api.get<{ data: CurrentServicesResult }>(
    `/vendors/${vendorId}/services`,
    {
      params: {
        limit: pageSize,
        offset: (page - 1) * pageSize,
        ...(filters.q ? { q: filters.q } : {}),
        ...(filters.model ? { model: filters.model } : {}),
      },
    }
  )
  const { groupedServices, attributeSet, files, fileCount, total } =
    res.data.data
  return {
    quotations: mapGroupedServicesToQuotations(groupedServices),
    attributeSet,
    files,
    fileCount,
    total,
  }
}

export const vendorQuotationsQuery = (
  vendorId: string,
  page: number,
  pageSize: number,
  filters: QuotationFilters = {}
) =>
  queryOptions({
    queryKey: vendorQuotationsKey(vendorId, page, pageSize, filters),
    queryFn: () => getVendorQuotations(vendorId, page, pageSize, filters),
    placeholderData: keepPreviousData,
  })
