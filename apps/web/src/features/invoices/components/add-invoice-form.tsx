import { FileUploadIcon, Upload01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@nom/ui/components/button"
import { Card } from "@nom/ui/components/card"
import { Field, FieldLabel } from "@nom/ui/components/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nom/ui/components/select"
import { cn } from "@nom/ui/lib/utils"
import { useQuery } from "@tanstack/react-query"
import { useRouter } from "@tanstack/react-router"
import { Loader2 } from "lucide-react"
import { useEffect, useState } from "react"
import { useInvoiceSubmit } from "@/features/invoices/hooks/use-invoice-submit"
import { vendorsQuery } from "@/features/vendors/services/vendors"
import { Dropzone } from "@/shared/components/dropzone"
import { PdfIcon, XIcon } from "@/shared/components/icons"
import { InvalidFilesDialog } from "@/shared/components/invalid-files-dialog"
import { ValidationWarningDialog } from "@/shared/components/validation-warning-dialog"
import { useFileUploads } from "@/shared/hooks/use-file-uploads"
import { formatFileSizeForDisplay } from "@/shared/lib/file"
import { PDF_UPLOAD } from "@/shared/lib/file-upload-limits"
import { takePendingFiles } from "@/shared/lib/pending-upload"

/** Invoice dropzone inner content; the "Choose Files" button bubbles its click
 *  to the zone, which opens the file picker. */
const DROP_CONTENT = (
  <>
    <HugeiconsIcon
      icon={FileUploadIcon}
      size={64}
      strokeWidth={0.75}
      className="text-foreground"
    />
    <p className="text-xl font-semibold text-secondary-foreground">
      Drop documents here
    </p>
    <p className="text-sm text-secondary-foreground">
      Drag and Drop file here or Choose file
    </p>
    <Button type="button" size="sm" className="mt-2 gap-3 px-4">
      <HugeiconsIcon icon={Upload01Icon} className="size-4" />
      Choose Files
    </Button>
  </>
)

export function AddInvoiceForm({
  vendorId: vendorIdParam,
}: {
  vendorId?: string
}) {
  const router = useRouter()
  const { data: vendors = [] } = useQuery(vendorsQuery)
  const [vendorId, setVendorId] = useState(vendorIdParam ?? "")

  const { uploads, appendFiles, removeFile } = useFileUploads("transaction")
  const { isExtracting, submit, invalidFilesDialog, validationWarningDialog } =
    useInvoiceSubmit(vendorId, uploads)

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only — takePendingFiles() is a one-shot read, so appendFiles in the deps would rerun this on every render and re-append nothing
  useEffect(() => {
    const files = takePendingFiles()
    if (files.length > 0) appendFiles(files)
  }, [])

  const canSubmit =
    !isExtracting &&
    uploads.length > 0 &&
    Boolean(vendorId) &&
    uploads.every((u) => u.status === "completed")

  return (
    <div className="flex flex-1 flex-col gap-3">
      <Card className="w-full flex-1 overflow-y-auto rounded-md border-none px-6 py-3.5 shadow-none">
        <div className="flex w-full max-w-xl flex-col gap-7 min-[1745px]:max-w-1/2">
          <Field>
            <FieldLabel>Upload Invoice</FieldLabel>
            <Dropzone
              multiple
              accept={[...PDF_UPLOAD.accept]}
              maxSize={PDF_UPLOAD.maxSize}
              onFiles={appendFiles}
              showHints
              className="min-h-64"
            >
              {DROP_CONTENT}
            </Dropzone>
          </Field>

          {uploads.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {uploads.map((upload) => (
                <li
                  key={upload.id}
                  className={cn(
                    "flex flex-col items-start gap-3 rounded-lg bg-accent px-4 py-3 shadow-xs",
                    upload.status === "uploading" && "border border-primary"
                  )}
                >
                  <div className="flex w-full items-start gap-3">
                    <PdfIcon className="size-4 shrink-0 text-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {upload.file.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatFileSizeForDisplay(upload.file.size)}
                      </p>

                      {upload.status === "error" ? (
                        <p className="mt-1 text-xs text-destructive">
                          {upload.error}
                        </p>
                      ) : null}
                    </div>

                    <button
                      type="button"
                      onClick={() => removeFile(upload.id)}
                      aria-label={`Remove ${upload.file.name}`}
                      className="shrink-0 cursor-pointer text-foreground"
                    >
                      <XIcon className="size-4" />
                    </button>
                  </div>

                  {upload.status === "uploading" && (
                    <div className="flex w-full items-center gap-2">
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-primary/20">
                        <div
                          className="h-full bg-primary transition-[width]"
                          style={{ width: `${upload.progress}%` }}
                        />
                      </div>
                      <span className="font-mono text-xs text-muted-foreground">
                        {upload.progress}%
                      </span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : null}

          <Field>
            <FieldLabel htmlFor="vendor">Vendor</FieldLabel>
            <Select
              value={vendorId}
              onValueChange={setVendorId}
              disabled={Boolean(vendorIdParam)}
            >
              <SelectTrigger id="vendor" className="w-full">
                <SelectValue placeholder="Select vendor" />
              </SelectTrigger>
              <SelectContent>
                {vendors.map((vendor) => (
                  <SelectItem key={vendor.id} value={vendor.id}>
                    {vendor.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={isExtracting}
              onClick={() => router.history.back()}
            >
              Cancel
            </Button>
            <Button type="button" onClick={submit} disabled={!canSubmit}>
              {isExtracting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Extracting…
                </>
              ) : (
                <>
                  Extract
                  {uploads.length > 0 ? ` · ${uploads.length} Files` : ""}
                </>
              )}
            </Button>
          </div>
        </div>
      </Card>

      <InvalidFilesDialog {...invalidFilesDialog} />
      <ValidationWarningDialog {...validationWarningDialog} />
    </div>
  )
}
