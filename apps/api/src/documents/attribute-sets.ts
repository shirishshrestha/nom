import type { DocumentType } from '@nom/shared';
import { attributeSetsFor } from '../attribute-set';
import type { PromptTemplate } from '../infra/llm/prompt.types';

// System prompt for the multimodal extract call: lists the candidate sets for
// this documentType so the model picks `attributeSet` + decides `isFinancial`,
// and instructs it to sectionize the document's pricing/charge blocks.
// (The attribute-set registry itself now lives in `src/attributes/`.)
export function buildExtractionSystemPrompt(
  documentType: DocumentType,
): string {
  const setList = attributeSetsFor(documentType)
    .map((s) => `   - "${s.key}" (${s.label}): ${s.description}`)
    .join('\n');

  // Transactions chunk by INVOICE, not by topic — a transaction file may be a
  // single invoice or a bundle of many, and each invoice's header/charges/totals
  // must stay together. It also reports billed totals the generic prompt does not.
  if (documentType === 'transaction') {
    return buildTransactionExtractionSystemPrompt(setList);
  }

  return `You are a document preprocessor for business ${documentType} documents.

You receive a single ${documentType} document (a PDF). Do two things and return them in the required structure.

1. metadata:
   - FIRST fill classificationBasis — one line: what the content actually is → isFinancial → which attribute set fits → does it contradict the declared type. Every field below follows from it.
   - isFinancial: true ONLY if this is a genuine financial ${documentType} document. false for cover letters, terms-&-conditions-only pages, marketing, or any document with no prices/rates/charges.
   - attributeSet: pick the ONE key whose description best fits this document's content, or null if none fit:
${setList}
   - vendorName: the issuer / vendor / company name on the document, or null.
   - documentDate / validFrom / validTo: ISO yyyy-mm-dd dates if present, else null. validFrom/validTo are the effective / coverage window.
   - referenceNumbers: quote / policy / invoice / reference numbers (empty array if none).
   - currency: the primary ISO 4217 currency code, or null.
   - documentKind: a short free-text description, e.g. "freight quotation", "marine cargo policy".
   - summary: a concise 1-3 sentence overview of the whole document — what it is, what it prices/covers, and its scope (vendor, currency, validity window). This is read later by an extractor that only sees one chunk at a time, so make it self-contained.
   - typeMismatchReason / typeMismatch: even though you must pick an attributeSet from the list above, FIRST write typeMismatchReason — what in the content (if anything) reads as a billed invoice/endorsement (charges, quantity × unit price, GST, grand total) rather than a ${documentType} document, or null — then set typeMismatch to the verdict that follows.
   - log: provenance — for each metadata value above, set the matching log.<field> to where in the document you found it (e.g. "policy schedule header, page 1"). Set log.<field> to null whenever that field is null.

2. sections — split the document into closely related paragraph groups, in document order:
   - Group sentences/lines that belong to the same topic, charge block, or logical unit into one section.
   - Each section must be at least ~500 characters. Merge adjacent short paragraphs/clauses on the same topic until that floor is reached. Do not split a single coherent block across sections.
   - Every piece of text must appear in exactly one section — no overlapping or repeating content across sections.
   - Reproduce each section's text verbatim as plain text (garbled PDF table formatting is fine; do not skip or reformat). Never add Markdown syntax — no #, *, _, |, backticks, or bullet/heading markers.
   - Use the block's heading or topic as its label. If there is no heading, derive one from the content (e.g. "Origin charges", "Coverage clause 3").
   - Set isSummary=true for cover pages, tables of contents, indexes, or pure recap/grand-total blocks that repeat information already captured elsewhere — these are dropped and never saved.
   - Return an empty array only if the document has no text content at all.`;
}

// Transaction (invoice/endorsement) preprocessor: one section PER INVOICE + billed
// totals. A transaction file is a single invoice or a bundle of several; each
// invoice carries its own header, charge table, and Sub-Total/GST/Grand-Total.
function buildTransactionExtractionSystemPrompt(setList: string): string {
  return `You are a document preprocessor for business transaction documents (invoices and policy endorsements).

You receive a single transaction document (a PDF) that is EITHER one invoice OR a bundle of several invoices. Do two things and return them in the required structure.

1. metadata:
   - FIRST fill classificationBasis — one line: what the content actually is → isFinancial → which attribute set fits → does it contradict the declared type. Every field below follows from it.
   - isFinancial: true ONLY if this is a genuine billed transaction document (invoice, tax invoice, endorsement). false for cover letters, terms-&-conditions-only pages, marketing, or any document with no charges.
   - attributeSet: pick the ONE key whose description best fits this document's content, or null if none fit:
${setList}
   - vendorName: the issuer / vendor / company name on the document, or null.
   - documentDate / validFrom / validTo: ISO yyyy-mm-dd dates if present, else null.
   - referenceNumbers: EVERY invoice / tax-invoice / reference number found across the whole document (one per invoice in a bundle).
   - currency: the primary ISO 4217 currency code, or null.
   - documentKind: a short free-text description, e.g. "freight tax invoice bundle", "marine policy endorsement".
   - summary: a concise 1-3 sentence overview of the whole document — what it is, what it bills for, and its scope (vendor, currency, invoices covered). This is read later by an extractor that only sees one chunk at a time, so make it self-contained.
   - typeMismatchReason / typeMismatch: even though you must pick an attributeSet from the list above, FIRST write typeMismatchReason — what in the content (if anything) reads as a pricing/rate/policy catalogue (no billed charges — just rates or coverage terms) rather than a billed transaction document, or null — then set typeMismatch to the verdict that follows.
   - sectionTotals: ONE entry per invoice — { label: that invoice's reference number, amount: that invoice's Grand Total as a number }. Read the summary table if the document has one; otherwise take each invoice's own Grand Total. A single-invoice document yields exactly one entry.
   - total: the document grand total (the sum across all invoices, e.g. the summary table TOTAL row). For a single invoice this equals its Grand Total.
   - log: provenance — for each metadata value above, set the matching log.<field> to where in the document you found it. Set log.<field> to null whenever that field is null.

2. sections — one section per smallest self-contained billed unit, in document order. Let the document's own structure decide what that unit is; do not force a layout it doesn't have:
   - For most invoices the unit is the invoice itself: one section carrying its header context (invoice number, dates, reference/container/bill-period), its full charge/line-item table, and its Sub-Total / GST / Grand-Total, verbatim. A single invoice → one section; a bundle → one per invoice. Do NOT split one invoice across sections or merge two into one. Label = the invoice's reference number (e.g. "NCCP-2501-041"); derive a short label if it has none.
   - PREFER THE DETAIL OVER THE SUMMARY: when a document settles a batch of underlying items — individual insurance orders, certificates, shipments/consignments, risks, policies — and lists each with its own identifier and its own figures (sum insured, premium, amount), THAT per-item breakdown is the real content: emit one section per item, labelled by the item's identifier (e.g. "Insurance Order 22091341"), with its full detail verbatim. Never collapse the breakdown into a single section and never drop it. A roll-up that only recaps those items' totals (a summary/statement table) is then the summary — see below — not the content. If the document has no such breakdown, ignore this rule.
   - Set isSummary=true for any block that only recaps figures detailed elsewhere — top invoice-summary / statement-of-totals tables, plus bank-detail blocks, cover pages, tables of contents, and standalone Terms & Conditions. These are dropped and never saved as line-item chunks (their totals are still captured in metadata.sectionTotals/total above).
   - Reproduce each section's text verbatim as plain text (garbled PDF table formatting is fine; do not skip or reformat). Never add Markdown syntax — no #, *, _, |, backticks, or bullet/heading markers.
   - Return an empty array only if the document has no invoice content at all.`;
}

export const EXTRACTION_PROMPT: PromptTemplate<DocumentType> = {
  id: 'document.extract',
  version: 'v3',
  render: buildExtractionSystemPrompt,
};
