import { Button } from "@nom/ui/components/button"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Upload } from "lucide-react"
import { InvoiceIntake } from "@/features/dashboard/components/invoice-intake"
import { StatsOverview } from "@/features/dashboard/components/stats-overview"
import { dashboardMetricsQuery } from "@/features/dashboard/services/dashboard"
import { IncompleteQuotationBanner } from "@/features/quotations/components/incomplete-quotation-banner"

function UploadInvoiceButton() {
  return (
    <Button size="sm" asChild>
      <Link to="/invoice/add">
        <Upload /> Upload Invoice
      </Link>
    </Button>
  )
}

export const Route = createFileRoute("/_app/dashboard")({
  component: Dashboard,
  staticData: {
    title: "Dashboard",
    breadcrumb: "Dashboard",
    PageActions: UploadInvoiceButton,
  },
})

function Dashboard() {
  /** Both children read this same query, so guarding here keeps one failed request
   *  from stacking two error messages. The banner runs off its own query and stays. */
  const { isError } = useQuery(dashboardMetricsQuery)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-2">
      <div className="flex flex-col gap-5.5 px-2 py-1.5">
        <IncompleteQuotationBanner />
        {isError ? (
          <p className="px-2 text-sm text-destructive">
            Failed to load dashboard. Please try again.
          </p>
        ) : (
          <>
            <StatsOverview />
            <InvoiceIntake />
          </>
        )}
      </div>
    </div>
  )
}
