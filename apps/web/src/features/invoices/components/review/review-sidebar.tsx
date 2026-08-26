import { cn } from "@nom/ui/lib/utils"
import { useInvoiceReview } from "@/features/invoices/components/review/invoice-review-context"

function hasAttention(lineItems: { status: string | null }[]): boolean {
  return lineItems.some(
    (l) => l.status === "mismatch" || l.status === "needs_review"
  )
}

export function ReviewSidebar({
  vendorName,
}: {
  vendorName: string | undefined
}) {
  const { documents, activeDocId, selectDoc } = useInvoiceReview()

  return (
    <div className="flex h-full w-[280px] shrink-0 flex-col overflow-y-auto rounded-md border border-border bg-background">
      {documents.map((doc, i) => (
        <button
          key={doc.documentId}
          type="button"
          onClick={() => selectDoc(doc.documentId)}
          className={cn(
            "flex items-center gap-3 border-b border-border px-5 py-2.5 text-left",
            doc.documentId === activeDocId &&
              "border-l-2 border-l-blue-400 bg-blue-50"
          )}
        >
          <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
            {String(i + 1).padStart(2, "0")}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">
              {doc.fileName}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {vendorName}
            </p>
          </div>
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              hasAttention(doc.lineItems) ? "bg-red-500" : "bg-green-500"
            )}
          />
        </button>
      ))}
    </div>
  )
}
