/** PDF-only, 25MB cap — shared by the invoice and quotation dropzones. */
export const PDF_UPLOAD = {
  accept: ["application/pdf"],
  maxSize: 25 * 1024 * 1024,
} as const
