// Document ingestion (preprocess phase) — shared types.

export const DOCUMENT_STATUSES = {
  PENDING: 'pending',
  EXTRACTED: 'extracted',
  VALIDATED: 'validated',
  STAGED: 'staged', // services extracted and staged for review (pre-commit)
  PROCESSING: 'processing', // transaction line-item extraction in flight
  REJECTED: 'rejected',
  COMMITTED: 'committed',
  MATCHING: 'matching', // transaction line-item matching in flight (background job)
  MATCHED: 'matched', // line items matched + reconciled against the rate card

  DISCARDED: 'discarded', // deliberately abandoned (superseded by a newer doc for the vendor)
  SUPERSEDED: 'superseded', // same file re-extracted; this row replaced by a newer one
} as const;

export type DocumentStatus =
  (typeof DOCUMENT_STATUSES)[keyof typeof DOCUMENT_STATUSES];

// Reviewer-facing status for a transaction document (invoice) listing. Derived from
// the user-set reviewCompleted flag: reviewer marked done → Completed, otherwise Pending.
export const REVIEW_STATUSES = {
  PENDING: 'Pending',
  COMPLETED: 'Completed',
} as const;

export type ReviewStatus =
  (typeof REVIEW_STATUSES)[keyof typeof REVIEW_STATUSES];

// One sectionized content chunk extracted from a document.
export interface FactSection {
  label: string;
  text: string;
}

export interface DocumentVendorMatch {
  isMatch: boolean;
  reason: string;
}

// Per-field provenance — where in the document each metadata value was found.
export interface DocumentMetadataLog {
  attributeSet: string | null;
  vendorName: string | null;
  documentDate: string | null;
  validFrom: string | null;
  validTo: string | null;
  referenceNumbers: string | null;
  currency: string | null;
}

// One billed total on a transaction document. For a multi-invoice bundle there is
// one entry per invoice (label = invoice ref); a single invoice yields one entry.
export interface DocumentSectionTotal {
  label: string; // invoice ref / section label this total belongs to
  amount: number; // the invoice's grand total
}

// Structured metadata extracted from a document. Authoritative copy lives in
// Postgres (documents.metadata); Neo4j only mirrors the reasoning-relevant fields.
export interface DocumentMetadata {
  isFinancial: boolean;
  attributeSet: string | null;
  documentKind?: string;
  // Short LLM-written overview of the document, captured at metadata extraction and
  // fed back as context into downstream per-chunk extraction prompts.
  summary?: string | null;
  vendorName?: string | null;
  documentDate?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  referenceNumbers?: string[];
  currency?: string | null;
  pageCount?: number | null;
  log?: DocumentMetadataLog;
  validation?: { vendorMatch?: DocumentVendorMatch };
  // Transaction-only: billed totals read at extraction (per-invoice + document grand total).
  sectionTotals?: DocumentSectionTotal[];
  total?: number;
  typeMismatch?: boolean;
  typeMismatchReason?: string | null;
}
