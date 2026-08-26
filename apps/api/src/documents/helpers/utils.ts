// One-line, human/LLM-readable summary of a document, composed from metadata we
// already extracted — no LLM call. Stored on the graph node + edge so reasoning

import { REVIEW_STATUSES } from '@nom/shared';
import type { DocumentMetadata, ReviewStatus } from '@nom/shared';

// has context without a Postgres round-trip.
export function buildDocumentContext(m: DocumentMetadata): string {
  const parts = [
    m.documentKind,
    m.vendorName ? `from ${m.vendorName}` : null,
    m.validFrom || m.validTo
      ? `valid ${m.validFrom ?? '?'}–${m.validTo ?? '?'}`
      : null,
    m.currency,
    m.referenceNumbers?.length
      ? `refs: ${m.referenceNumbers.join(', ')}`
      : null,
  ].filter(Boolean);
  return parts.join(' · ');
}

// Reviewer-facing status for a transaction document: reviewer marked done → Completed,
// otherwise Pending. Shared by the document list and the match-status poll endpoint.
export function reviewStatusOf(reviewCompleted: boolean): ReviewStatus {
  return reviewCompleted ? REVIEW_STATUSES.COMPLETED : REVIEW_STATUSES.PENDING;
}
