import type { DocumentMetadata, DocumentType } from '@nom/shared';
import type { PromptTemplate } from '../../infra/llm/prompt.types';

export const VENDOR_MATCH_PROMPT = `You decide whether the vendor named on a document refers to the registered vendor in our system.

Use the registered vendor record (especially comments — aliases, trading names, spelling variants) and the current document metadata. Base your verdict only on the registered vendor record, not on any other documents.

Treat legal-suffix and abbreviation differences as a match when clearly the same entity. Write the reason FIRST — a concise, user-facing account of why the names do or do not refer to the same entity — then set isMatch to the verdict that follows from it.`;

export const VENDOR_MATCH_TEMPLATE: PromptTemplate<void> = {
  id: 'vendor.match',
  version: 'v2',
  render: () => VENDOR_MATCH_PROMPT,
};

type VendorFields = {
  name: string;
  code?: string | null;
  type?: string | null;
  location?: string | null;
  comments?: string | null;
};

function metaLine(
  label: string,
  value: string | null | undefined | string[],
): string | null {
  if (value == null || value === '') return null;
  if (Array.isArray(value) && value.length === 0) return null;
  return `${label}: ${Array.isArray(value) ? value.join(', ') : value}`;
}

export function formatDocMeta(
  metadata: DocumentMetadata,
  documentType: DocumentType,
): string {
  return [
    metaLine('Document type', documentType),
    metaLine('Financial document', metadata.isFinancial ? 'yes' : 'no'),
    metaLine('Attribute set', metadata.attributeSet),
    metaLine('Document kind', metadata.documentKind),
    metaLine('Vendor name (extracted)', metadata.vendorName),
    metaLine('Document date', metadata.documentDate),
    metaLine('Valid from', metadata.validFrom),
    metaLine('Valid to', metadata.validTo),
    metaLine('Reference numbers', metadata.referenceNumbers),
    metaLine('Currency', metadata.currency),
  ]
    .filter((l): l is string => l != null)
    .join('\n');
}

export function formatVendor(vendor: VendorFields | null | undefined): string {
  const lines: string[] = [];
  if (vendor) {
    for (const l of [
      metaLine('Name', vendor.name),
      metaLine('Code', vendor.code),
      metaLine('Type', vendor.type),
      metaLine('Location', vendor.location),
      metaLine('Comments', vendor.comments),
    ]) {
      if (l) lines.push(l);
    }
  }
  return lines.join('\n');
}
