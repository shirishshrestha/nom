import { Button } from "@nom/ui/components/button"
import { toast } from "@nom/ui/components/sonner"
import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { CompleteReviewDialog } from "@/features/invoices/components/review/complete-review-dialog"
import { useInvoiceReview } from "@/features/invoices/components/review/invoice-review-context"
import { useMarkReviewedMutation } from "@/features/invoices/services/invoice-review"

/**
 * Complete marks every document in the batch reviewed — not just the active one
 * — then lands on the list where they read Completed. It stays put on failure so
 * the click can be retried; Cancel leaves without marking anything.
 */
export function ReviewFooter() {
  const navigate = useNavigate()
  const { documents } = useInvoiceReview()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const markReviewed = useMarkReviewedMutation()

  const isProcessing = documents.some((d) => d.isMatching)

  return (
    <div className="flex items-center justify-end gap-3 border-t border-border px-4 py-3">
      <Button variant="outline" onClick={() => navigate({ to: "/invoice" })}>
        Cancel
      </Button>
      <Button
        disabled={documents.length === 0 || isProcessing}
        onClick={() => setConfirmOpen(true)}
      >
        Complete
      </Button>

      <CompleteReviewDialog
        open={confirmOpen}
        fileNames={documents.map((d) => d.fileName)}
        isPending={markReviewed.isPending}
        onOpenChange={setConfirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() =>
          markReviewed.mutate(
            documents.map((d) => d.documentId),
            {
              onSuccess: () => {
                toast.success(
                  documents.length > 1
                    ? `${documents.length} invoices marked reviewed`
                    : "Invoice marked reviewed"
                )
                setConfirmOpen(false)
                navigate({ to: "/invoice" })
              },
            }
          )
        }
      />
    </div>
  )
}
