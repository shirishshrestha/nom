import type { DocumentMetadata, DocumentType } from '@nom/shared';
import { getAttributeSet } from '../attribute-set';

// Pure validation logic — no LLM, no DB. Unit-tested in validation.spec.ts.

// Financial hard-gate: the document must be financial AND classified into an
// attribute set that exists for its documentType. Returns false otherwise
// (caller hard-rejects). Uses the strict getAttributeSet (no fallback).
export function isValidFinancialDocument(
  metadata: DocumentMetadata,
  documentType: DocumentType,
): boolean {
  if (!metadata.isFinancial) return false;
  const set = getAttributeSet(metadata.attributeSet);
  return !!set && set.documentType === documentType;
}
