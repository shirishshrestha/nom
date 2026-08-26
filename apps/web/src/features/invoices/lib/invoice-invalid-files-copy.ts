/**
 * Copy for the InvalidFilesDialog when an add-invoice batch can't proceed. Invoices
 * don't need quotations' "isFinancial" branch (that distinction exists there because
 * rate cards are commonly confused with POs/contracts) — an invoice is already a
 * financial document by definition, so one rejected-files copy covers every case.
 */
export const rejectedInvoiceFilesCopy = (count: number) => ({
  title:
    count === 1
      ? "This file couldn't be added"
      : "Some files couldn't be added",
  description: `We couldn't add the following ${count === 1 ? "file" : "files"} to this invoice. Review the reason for each below and update your selection to continue.`,
})
