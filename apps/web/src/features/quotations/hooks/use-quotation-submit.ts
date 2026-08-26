import { toast } from "@nom/ui/components/sonner"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import {
  extractedAttributeSet,
  extractedDocumentKind,
  extractedIsFinancial,
} from "@/features/quotations/lib/document-metadata"
import {
  invalidQuotationCopy,
  mismatchedTypesCopy,
  rejectedFilesCopy,
} from "@/features/quotations/lib/invalid-files-copy"
import {
  uncommittedQuery,
  useDiscardVendorMutation,
  useValidateDocumentMutation,
} from "@/features/quotations/services/rules-review"
import { getErrorMessage } from "@/lib/errors"
import type { InvalidFile } from "@/shared/components/invalid-files-dialog"
import type { WarnedFile } from "@/shared/components/validation-warning-dialog"
import type { UploadItem } from "@/shared/hooks/use-file-uploads"
import {
  useConfirmManyMutation,
  useExtractMetadataMutation,
} from "@/shared/services/file-batch"

/**
 * Drives the add-quotation submit saga: confirm over any in-progress upload,
 * extract metadata, gate on mixed document types, validate, gate on rejected
 * files, gate on warned files (continue-or-discard), then navigate to review.
 * Owns the invalid-files + confirm-discard + validation-warning dialog state
 * and returns ready-to-spread props for each. Unlike invoices, Discard here
 * abandons the whole batch (`useDiscardVendorMutation`) rather than just the
 * warned documents — quotations have no per-document discard endpoint.
 */
export function useQuotationSubmit(vendorId: string, uploads: UploadItem[]) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const confirmMany = useConfirmManyMutation()
  const extractMetadata = useExtractMetadataMutation()
  const discard = useDiscardVendorMutation()
  const validate = useValidateDocumentMutation(vendorId)

  const [isExtracting, setIsExtracting] = useState(false)
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false)
  const [invalidFilesOpen, setInvalidFilesOpen] = useState(false)
  const [invalidFiles, setInvalidFiles] = useState<InvalidFile[]>([])
  const [invalidCopy, setInvalidCopy] = useState(rejectedFilesCopy(0))

  const [warningOpen, setWarningOpen] = useState(false)
  const [warnedFiles, setWarnedFiles] = useState<WarnedFile[]>([])

  function continueWithWarnings() {
    setWarningOpen(false)
    navigate({ to: "/quotation/review", search: { vendorId } })
  }

  async function discardWarned() {
    setWarningOpen(false)
    await discard.mutateAsync(vendorId)
    toast.success("Upload discarded")
  }

  async function submit() {
    const existing = await qc.fetchQuery(uncommittedQuery(vendorId))
    if (existing.documents.length > 0) setConfirmDiscardOpen(true)
    else runSubmit()
  }

  async function discardAndContinue() {
    setConfirmDiscardOpen(false)
    await discard.mutateAsync(vendorId)
    runSubmit()
  }

  async function runSubmit() {
    const completed = uploads.flatMap((u) =>
      u.status === "completed" ? [u] : []
    )
    setIsExtracting(true)
    try {
      await confirmMany.mutateAsync({
        vendorId,
        ids: completed.map((u) => u.fileId),
      })
      const docs = await extractMetadata.mutateAsync(
        completed.map((u) => u.fileId)
      )
      const attributeSets = docs.map((d) => extractedAttributeSet(d.metadata))
      if (new Set(attributeSets).size > 1) {
        const mismatched = docs.flatMap((d) => {
          const up = completed.find((u) => u.fileId === d.fileId)
          return up
            ? [
                {
                  name: up.file.name,
                  size: up.file.size,
                  reason: `Document type: ${extractedDocumentKind(d.metadata) ?? "unknown"}`,
                },
              ]
            : []
        })
        setInvalidFiles(mismatched)
        setInvalidCopy(mismatchedTypesCopy(mismatched.length))
        setInvalidFilesOpen(true)
        return
      }
      const results = await Promise.all(
        docs.map((d) => validate.mutateAsync(d.documentId))
      )
      const invalid = results.flatMap((res, i) => {
        if (res.status !== "rejected") return []
        const up = completed.find((u) => u.fileId === docs[i].fileId)
        return up
          ? [
              {
                name: up.file.name,
                size: up.file.size,
                reason: res.rejectReason,
              },
            ]
          : []
      })
      if (invalid.length > 0) {
        const allNonFinancial = results.every(
          (res) =>
            res.status !== "rejected" ||
            extractedIsFinancial(res.metadata) === false
        )
        setInvalidFiles(invalid)
        setInvalidCopy(
          allNonFinancial
            ? invalidQuotationCopy(invalid.length)
            : rejectedFilesCopy(invalid.length)
        )
        setInvalidFilesOpen(true)
        return
      }

      const warned = results.flatMap((res, i) => {
        if (res.warnings.length === 0) return []
        const up = completed.find((u) => u.fileId === docs[i].fileId)
        return up
          ? [{ name: up.file.name, size: up.file.size, warnings: res.warnings }]
          : []
      })
      if (warned.length > 0) {
        setWarnedFiles(warned)
        setWarningOpen(true)
        return
      }

      navigate({ to: "/quotation/review", search: { vendorId } })
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to start extraction"))
    } finally {
      setIsExtracting(false)
    }
  }

  return {
    isExtracting,
    submit,
    invalidFilesDialog: {
      open: invalidFilesOpen,
      files: invalidFiles,
      title: invalidCopy.title,
      description: invalidCopy.description,
      onOpenChange: setInvalidFilesOpen,
    },
    confirmDiscardDialog: {
      open: confirmDiscardOpen,
      onOpenChange: setConfirmDiscardOpen,
      onConfirm: discardAndContinue,
      isPending: discard.isPending,
    },
    validationWarningDialog: {
      open: warningOpen,
      files: warnedFiles,
      discardHint: "along with the rest of this upload",
      onOpenChange: setWarningOpen,
      onContinue: continueWithWarnings,
      onDiscard: discardWarned,
      isPending: discard.isPending,
    },
  }
}
