import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { RulesReview } from "@/features/quotations/components/review/rules-review"
import { uncommittedQuery } from "@/features/quotations/services/rules-review"

const reviewSearchSchema = z.object({ vendorId: z.string().uuid() })

export const Route = createFileRoute("/_app/quotation/review")({
  validateSearch: reviewSearchSchema,
  loaderDeps: ({ search }) => ({ vendorId: search.vendorId }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(uncommittedQuery(deps.vendorId)),
  component: RulesReviewPage,
  staticData: { title: "Rules Review", breadcrumb: "Quotation" },
})

function RulesReviewPage() {
  const { vendorId } = Route.useSearch()
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <RulesReview vendorId={vendorId} />
    </div>
  )
}
