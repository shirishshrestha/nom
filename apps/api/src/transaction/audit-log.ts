/**
 * Audit-trail helpers for a line item's `log` array. Index 0 is always the
 * provenance header (where the line came from); every later entry is one
 * timestamped event, so the :LineItem node always carries its full a–z history.
 */
export function provenanceHeader(p: {
  documentId: string;
  contentId: string;
  invoiceRef: string;
  position: number;
  extractor: string;
}): string {
  return `origin · doc=${p.documentId} · chunk=${p.contentId} · invoice=${p.invoiceRef} · pos=${p.position} · extractor=${p.extractor}`;
}

/** Stamp an event with an ISO timestamp. ponytail: a 2-line helper, not a logging class. */
export function logEntry(message: string): string {
  return `${new Date().toISOString()} · ${message}`;
}
