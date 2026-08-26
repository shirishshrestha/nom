import { DocumentAttachmentIcon, Store03Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@nom/ui/components/button"
import { Card } from "@nom/ui/components/card"
import { Skeleton } from "@nom/ui/components/skeleton"
import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { Upload } from "lucide-react"
import { dashboardMetricsQuery } from "@/features/dashboard/services/dashboard"
import { Dropzone } from "@/shared/components/dropzone"
import { PDF_UPLOAD } from "@/shared/lib/file-upload-limits"
import { setPendingFiles } from "@/shared/lib/pending-upload"

function IntakeEmptyCard({
  icon,
  title,
  description,
  to,
  action,
}: {
  icon: typeof Store03Icon
  title: string
  description: string
  to: "/vendor/add" | "/quotation/add"
  action: string
}) {
  return (
    <Card className="p-2xl min-h-105 w-full items-center justify-center gap-7 border-zinc-300 text-center lg:w-88.75">
      <HugeiconsIcon
        icon={icon}
        size={56}
        strokeWidth={1}
        className="text-foreground"
      />
      <p className="font-heading text-base font-semibold">{title}</p>
      <p className="max-w-64 text-base font-semibold text-zinc-500">
        {description}
      </p>
      <Button variant="secondary" size="lg" asChild>
        <Link to={to}>
          <Upload /> {action}
        </Link>
      </Button>
    </Card>
  )
}

function VendorsEmpty() {
  return (
    <IntakeEmptyCard
      icon={Store03Icon}
      title="No Vendors Added Yet"
      description="Add your first vendor to start managing Quotations, invoices, and verification workflows."
      to="/vendor/add"
      action="Add first vendor"
    />
  )
}

function QuotationsEmpty() {
  return (
    <IntakeEmptyCard
      icon={DocumentAttachmentIcon}
      title="No Quotation Added Yet"
      description="Add a quotation to verify invoices against agreed pricing and track exceptions."
      to="/quotation/add"
      action="Add first quotation"
    />
  )
}

function QuotationsReady() {
  return (
    <IntakeEmptyCard
      icon={DocumentAttachmentIcon}
      title="Add a Quotation"
      description="Add another quotation to verify invoices against agreed pricing and track exceptions."
      to="/quotation/add"
      action="Add quotation"
    />
  )
}

function UploadZone() {
  const navigate = useNavigate()

  return (
    <div className="flex flex-1 flex-col gap-2">
      <p className="text-sm font-medium text-card-foreground">Upload Invoice</p>
      <Dropzone
        multiple
        accept={[...PDF_UPLOAD.accept]}
        maxSize={PDF_UPLOAD.maxSize}
        onFiles={(files) => {
          setPendingFiles(files)
          navigate({ to: "/invoice/add" })
        }}
        showHints
        className="flex-1 bg-white"
      />
    </div>
  )
}

function IntakeCardSkeleton() {
  return <Skeleton className="min-h-105 w-full rounded-xl lg:w-88.75" />
}

function IntakeStatus({
  hasVendors,
  hasQuotations,
}: {
  hasVendors: boolean
  hasQuotations: boolean
}) {
  if (!hasVendors) return <VendorsEmpty />
  if (!hasQuotations) return <QuotationsEmpty />
  return <QuotationsReady />
}

export function InvoiceIntake() {
  const { data, isPending } = useQuery(dashboardMetricsQuery)

  return (
    <div className="flex flex-col gap-9 lg:flex-row">
      {isPending ? (
        <IntakeCardSkeleton />
      ) : (
        <IntakeStatus
          hasVendors={data?.status.hasVendors ?? false}
          hasQuotations={data?.status.hasQuotations ?? false}
        />
      )}
      <UploadZone />
    </div>
  )
}
