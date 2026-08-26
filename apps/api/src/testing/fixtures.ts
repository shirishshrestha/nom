import { statSync } from 'fs';
import { join } from 'path';
import { DOCUMENT_TYPES, FILE_CATEGORIES } from '@nom/shared';
import type { PresignFileDto } from '@nom/dtos';

export const FIXTURE_DIR = join(process.cwd(), 'src/testing/fixtures');

export const FIXTURE_FILE = join(FIXTURE_DIR, 'source.pdf');

// Per-document-type fixture, e.g. fixtures/source.pdf, fixtures/transaction.pdf.
export const fixtureFor = (documentType: string) =>
  join(FIXTURE_DIR, `${documentType}.pdf`);

export function makeFileDto(
  overrides: Partial<PresignFileDto> = {},
): PresignFileDto {
  return {
    name: 'sample.pdf',
    mimeType: 'application/pdf',
    sizeBytes: statSync(FIXTURE_FILE).size,
    documentType: DOCUMENT_TYPES.SOURCE,
    category: FILE_CATEGORIES.DOCUMENT,
    ...overrides,
  };
}
