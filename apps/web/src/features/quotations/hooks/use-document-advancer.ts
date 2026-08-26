import { useEffect, useRef, useState } from "react"
import { useExtractServicesMutation } from "@/features/quotations/services/rules-review"
import type { UncommittedDocument } from "@/features/quotations/types"

export type AdvanceState = "extracting" | "error"

/**
 * Status-driven auto-advance: stage every validated doc (validated →
 * extract-services → staged). Validation runs upfront in the add-quotation
 * form (financial gate + blocker dialog), so docs arrive here already
 * validated — this only does staging. Docs advance in parallel
 * (Promise.allSettled); one failure doesn't block the others.
 * extract-services invalidates the uncommitted query → refetch → this
 * effect re-runs off the fresh status (idempotent, re-runnable).
 */
export function useDocumentAdvancer(
  vendorId: string,
  documents: UncommittedDocument[]
): Record<string, AdvanceState> {
  const extract = useExtractServicesMutation(vendorId)
  const [state, setState] = useState<Record<string, AdvanceState>>({})
  const inFlight = useRef(new Set<string>())
  const errored = useRef(new Set<string>())

  useEffect(() => {
    const pending = documents.filter(
      (d) =>
        d.status === "validated" &&
        !inFlight.current.has(d.documentId) &&
        !errored.current.has(d.documentId)
    )
    if (pending.length === 0) return

    for (const doc of pending) inFlight.current.add(doc.documentId)

    void Promise.allSettled(
      pending.map(async (doc) => {
        try {
          setState((s) => ({ ...s, [doc.documentId]: "extracting" }))
          await extract.mutateAsync(doc.documentId)
          setState((s) => {
            const { [doc.documentId]: _done, ...rest } = s
            return rest
          })
        } catch {
          errored.current.add(doc.documentId)
          setState((s) => ({ ...s, [doc.documentId]: "error" }))
        } finally {
          inFlight.current.delete(doc.documentId)
        }
      })
    )
    // extract mutate fn is stable enough; re-run is keyed off `documents` changing
    // after each invalidation, which is exactly when the next doc is due.
  }, [documents, extract])

  return state
}
