/**
 * Copy for the InvalidFilesDialog, per reason an add-quotation batch can't
 * proceed. When every rejected file is non-financial we know none is a
 * Quotation, so use the strong "invalid document" wording. Otherwise the files
 * are valid but can't be added (e.g. type conflicts with the vendor's existing
 * documents) — stay neutral and let each file's server-authored rejectReason
 * carry the specifics.
 */
export const invalidQuotationCopy = (count: number) => ({
  title: "Invalid Quotation document found",
  description: `We couldn't identify a valid Quotation document in the following ${count === 1 ? "file" : "files"}. Review the selected files and upload the correct Quotation document to continue.`,
})

export const rejectedFilesCopy = (count: number) => ({
  title:
    count === 1
      ? "This file couldn't be added"
      : "Some files couldn't be added",
  description: `We couldn't add the following ${count === 1 ? "file" : "files"} to this quotation. Review the reason for each below and update your selection to continue.`,
})

export const mismatchedTypesCopy = (count: number) => ({
  title: "Multiple document types found",
  description: `The selected files contain different document types. A quotation can only include one document type — remove the mismatched ${count === 1 ? "file" : "files"} and try again.`,
})
