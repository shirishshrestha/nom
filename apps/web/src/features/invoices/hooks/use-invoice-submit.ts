import { toast } from "@nom/ui/components/sonner"
import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { rejectedInvoiceFilesCopy } from "@/features/invoices/lib/invoice-invalid-files-copy"
import {
  useExtractLineItemsMutation,
  useValidateDocumentMutation,
} from "@/features/invoices/services/invoice-upload"
import { getErrorMessage } from "@/lib/errors"
import type { InvalidFile } from "@/shared/components/invalid-files-dialog"
import type { WarnedFile } from "@/shared/components/validation-warning-dialog"
import type { UploadItem } from "@/shared/hooks/use-file-uploads"
import {
  type FileExtractResult,
  useConfirmManyMutation,
  useExtractMetadataMutation,
} from "@/shared/services/file-batch"

/**
 * Drives the add-invoice submit saga: confirm the upload, extract metadata, validate,
 * gate on rejected files, gate on warned files (continue-or-discard), then extract
 * line items and navigate to review. No uncommitted-check/discard step (transactions
 * have no equivalent of /source/uncommitted) and no mark-ready/commit-all
 * (extract-line-items already commits) — unlike quotations, matching happens on
 * arrival at /invoice/review, not here.
 */
export function useInvoiceSubmit(vendorId: string, uploads: UploadItem[]) {
  const navigate = useNavigate()
  const confirmMany = useConfirmManyMutation()
  const extractMetadata = useExtractMetadataMutation()
  const validate = useValidateDocumentMutation()
  const extractLineItems = useExtractLineItemsMutation()

  const [isExtracting, setIsExtracting] = useState(false)
  const [invalidFilesOpen, setInvalidFilesOpen] = useState(false)
  const [invalidFiles, setInvalidFiles] = useState<InvalidFile[]>([])
  const [invalidCopy, setInvalidCopy] = useState(rejectedInvoiceFilesCopy(0))

  const [warningOpen, setWarningOpen] = useState(false)
  const [warnedFiles, setWarnedFiles] = useState<WarnedFile[]>([])
  const [pendingValidDocs, setPendingValidDocs] = useState<FileExtractResult[]>(
    []
  )
  const [warnedDocumentIds, setWarnedDocumentIds] = useState<Set<string>>(
    new Set()
  )

  async function extractAndNavigate(docs: FileExtractResult[]) {
    if (docs.length === 0) return
    setIsExtracting(true)
    try {
      const extracted = await Promise.all(
        docs.map((d) => extractLineItems.mutateAsync(d.documentId))
      )
      navigate({
        to: "/invoice/review",
        search: { vendorId, documentIds: extracted.map((e) => e.documentId) },
      })
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to start extraction"))
    } finally {
      setIsExtracting(false)
    }
  }

  function continueWithWarnings() {
    setWarningOpen(false)
    extractAndNavigate(pendingValidDocs)
  }

  function discardWarned() {
    setWarningOpen(false)
    extractAndNavigate(
      pendingValidDocs.filter((d) => !warnedDocumentIds.has(d.documentId))
    )
  }

  async function submit() {
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
        setInvalidFiles(invalid)
        setInvalidCopy(rejectedInvoiceFilesCopy(invalid.length))
        setInvalidFilesOpen(true)
        return
      }

      const validDocs = docs.filter((_, i) => results[i].status === "validated")
      const warned = results.flatMap((res, i) => {
        if (res.warnings.length === 0) return []
        const up = completed.find((u) => u.fileId === docs[i].fileId)
        return up
          ? [{ name: up.file.name, size: up.file.size, warnings: res.warnings }]
          : []
      })
      if (warned.length > 0) {
        const warnedIds = new Set(
          docs
            .filter((_, i) => results[i].warnings.length > 0)
            .map((d) => d.documentId)
        )
        setPendingValidDocs(validDocs)
        setWarnedDocumentIds(warnedIds)
        setWarnedFiles(warned)
        setWarningOpen(true)
        return
      }

      await extractAndNavigate(validDocs)
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
    validationWarningDialog: {
      open: warningOpen,
      files: warnedFiles,
      discardHint: "and extract the rest",
      onOpenChange: setWarningOpen,
      onContinue: continueWithWarnings,
      onDiscard: discardWarned,
      isPending: isExtracting,
    },
  }
}
