import { useEffect, useRef } from "react"
import { useMatchLineItemsMutation } from "@/features/invoices/services/invoice-review"
import type { InvoiceDocument } from "@/features/invoices/types"

/**
 * Callers must pass `documents` with each `status` kept live (see
 * invoice-review-context.tsx, which overlays matchStatusQuery's polled result) —
 * a queued (async) match job resolves its POST immediately, well before the
 * background worker finishes, so "already pending" can't be judged from that
 * promise settling.
 *
 * A *synchronous* match (the common case here) resolves with the final result,
 * but the document's own `status` is never flipped to `matched` on that path —
 * it stays `committed` forever (only the async/queued path's background worker
 * does that transition). So `attempted`, not `documents`/`status`, is what gates
 * re-firing: once a doc's match has been requested this session, it's done —
 * checking `status` again would refire it forever for a synchronously-matched doc.
 */
export function useDocumentMatcher(documents: InvoiceDocument[]): void {
  const match = useMatchLineItemsMutation()
  const matchRef = useRef(match)
  matchRef.current = match

  const attempted = useRef(new Set<string>())

  const statusKey = documents
    .map((d) => `${d.documentId}:${d.status}`)
    .join(",")

  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on statusKey (a documentId:status digest), not documents/match — both are new references every render, which would otherwise rerun this on every unrelated render instead of only when a document's status actually changes
  useEffect(() => {
    const pending = documents.filter(
      (d) =>
        d.status !== "matching" &&
        d.status !== "matched" &&
        !attempted.current.has(d.documentId)
    )
    if (pending.length === 0) return

    for (const doc of pending) attempted.current.add(doc.documentId)

    void Promise.allSettled(
      pending.map((doc) => matchRef.current.mutateAsync(doc.documentId))
    )
  }, [statusKey])
}
