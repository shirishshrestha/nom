import { z } from 'zod';

// Structured-output schema for the multimodal extract call — returns document
// metadata AND sectionized content in one shot. See buildExtractionSystemPrompt.

export const SectionSchema = z.object({
  label: z
    .string()
    .describe('Heading, topic, or short descriptor for this paragraph group'),
  text: z
    .string()
    .describe(
      'Full verbatim text of this paragraph group, as it appears in the document',
    ),
  page: z
    .number()
    .int()
    .nullable()
    .describe(
      '1-based page number where this paragraph group appears, or null if unknown.',
    ),
  isSummary: z
    .boolean()
    .describe(
      'True for a cover page, table of contents, index, or pure recap block with no new content — these are dropped and never saved.',
    ),
});

// Per-field provenance — where in the document each metadata value was found.
// Keyed per field so it stays queryable (metadata->'log'->>'validFrom').
export const MetadataLogSchema = z.object({
  attributeSet: z
    .string()
    .nullable()
    .describe('Where/why you picked this attribute set, or null.'),
  vendorName: z
    .string()
    .nullable()
    .describe('Where the vendor/issuer name was found, or null.'),
  documentDate: z
    .string()
    .nullable()
    .describe('Where the document date was found, or null.'),
  validFrom: z
    .string()
    .nullable()
    .describe('Where the effective-from date was found, or null.'),
  validTo: z
    .string()
    .nullable()
    .describe('Where the effective-to date was found, or null.'),
  referenceNumbers: z
    .string()
    .nullable()
    .describe('Where the reference numbers were found, or null.'),
  currency: z
    .string()
    .nullable()
    .describe('Where/how the currency was determined, or null.'),
});

export const MetadataSchema = z.object({
  classificationBasis: z
    .string()
    .describe(
      'Scratch space: one line applying the classification procedure — what the content actually IS (billed charges vs priced/coverage catalogue vs neither), so isFinancial; which attribute set that selects (or null); whether that contradicts the declared type. Fill this FIRST; it is discarded after extraction.',
    ),
  isFinancial: z
    .boolean()
    .describe(
      'True only for a genuine financial document (rate card, quotation, insurance policy, invoice, endorsement). False for cover letters, T&C-only pages, marketing, or any document with no prices.',
    ),
  attributeSet: z
    .string()
    .nullable()
    .describe(
      "The attribute-set key that best fits this document, or null if none fit (e.g. 'quotation', 'insurance', 'invoice', 'endorsement').",
    ),
  documentKind: z
    .string()
    .describe(
      'Short free-text kind, e.g. "freight quotation", "marine cargo policy".',
    ),
  summary: z
    .string()
    .describe(
      'A concise 1-3 sentence overview of the document: what it is, what it prices/covers, and its scope (vendor, currency, validity window). Written for a downstream extractor that only sees one chunk at a time.',
    ),
  vendorName: z
    .string()
    .nullable()
    .describe('Issuer / vendor / company name on the document, or null.'),
  documentDate: z
    .string()
    .nullable()
    .describe('Document date as ISO yyyy-mm-dd if present, else null.'),
  validFrom: z
    .string()
    .nullable()
    .describe(
      'Effective-from / coverage-start date ISO yyyy-mm-dd if present, else null.',
    ),
  validTo: z
    .string()
    .nullable()
    .describe(
      'Effective-to / coverage-end date ISO yyyy-mm-dd if present, else null.',
    ),
  referenceNumbers: z
    .array(z.string())
    .describe(
      'Quote / policy / invoice / reference numbers; empty array if none.',
    ),
  currency: z
    .string()
    .nullable()
    .describe('Primary ISO 4217 currency code, or null.'),
  pageCount: z
    .number()
    .int()
    .nullable()
    .describe('Total number of pages in the document, or null if unknown.'),
  log: MetadataLogSchema.describe(
    'For each metadata value you filled, note where in the document you found it. Null per field when that field is null.',
  ),
  sectionTotals: z
    .array(
      z.object({
        label: z
          .string()
          .describe('Invoice reference / section label this total belongs to.'),
        amount: z
          .number()
          .describe(
            "That invoice's grand total as a number — no symbol, no commas.",
          ),
      }),
    )
    .optional()
    .describe(
      'TRANSACTION documents only: one entry per invoice (its grand total). A single invoice yields one entry; a bundle yields one per invoice. Omit for non-transaction documents.',
    ),
  total: z
    .number()
    .optional()
    .describe(
      'TRANSACTION documents only: the document grand total (sum across all invoices). Omit for non-transaction documents.',
    ),
  typeMismatchReason: z
    .string()
    .nullable()
    .describe(
      'Decide FIRST: a concise reason citing what in the content contradicts the declared type, or null when nothing does. typeMismatch follows from this.',
    ),
  typeMismatch: z
    .boolean()
    .describe(
      "The verdict that follows from typeMismatchReason: true if this document's actual content looks like the OTHER document kind (a billed invoice/endorsement vs. a pricing/rate/policy catalogue) rather than what was declared, regardless of which attributeSet you were forced to pick. False otherwise.",
    ),
});

export const ExtractionSchema = z.object({
  metadata: MetadataSchema,
  sections: z
    .array(SectionSchema)
    .describe(
      'Document content split into closely related paragraph groups, in document order.',
    ),
});

export type ExtractionResult = z.infer<typeof ExtractionSchema>;

export const VendorMatchSchema = z.object({
  reason: z
    .string()
    .describe(
      'Decide FIRST: why the two names do or do not refer to the same entity (aliases, legal suffixes, abbreviations considered).',
    ),
  isMatch: z.boolean().describe('The verdict that follows from the reason.'),
});
