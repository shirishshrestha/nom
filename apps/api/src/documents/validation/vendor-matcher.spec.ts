import { jest } from '@jest/globals';
import { DocumentEntity, VendorEntity } from '@nom/database';
import type { DocumentMetadata } from '@nom/shared';
import { VendorMatcher } from './vendor-matcher';
import { FakeStructuredExtractor } from '../../infra/llm/fake.structured-extractor';
import type { Repository } from 'typeorm';

function build(matchResult = { isMatch: true, reason: 'same entity' }) {
  const fake = new FakeStructuredExtractor(() => matchResult);
  const vendorsRepo = {
    findOneBy: jest.fn(() => Promise.resolve({ id: 'v1', name: 'Northstar' })),
  } as unknown as Repository<VendorEntity>;
  return {
    matcher: new VendorMatcher(fake, vendorsRepo),
    fake,
    vendorsRepo,
  };
}

const doc = {
  id: 'd1',
  vendorId: 'v1',
  documentType: 'source',
} as DocumentEntity;

describe('VendorMatcher', () => {
  it('skips (null) when there is no extracted vendor name', async () => {
    const { matcher } = build();
    const res = await matcher.match('org-1', doc, {
      vendorName: null,
    } as DocumentMetadata);
    expect(res).toBeNull();
  });

  it('skips (null) when the document has no linked vendor', async () => {
    const { matcher } = build();
    const res = await matcher.match('org-1', { ...doc, vendorId: undefined }, {
      vendorName: 'Northstar',
    } as DocumentMetadata);
    expect(res).toBeNull();
  });

  it('returns the LLM verdict against the registered vendor only', async () => {
    const { matcher, fake } = build({
      isMatch: false,
      reason: 'different company',
    });
    const res = await matcher.match('org-1', doc, {
      vendorName: 'Northstar Pte',
    } as DocumentMetadata);

    expect(res).toEqual({ isMatch: false, reason: 'different company' });
    // The prompt is built from the vendor record, never from other documents.
    expect(fake.calls[0].human).toContain('Registered vendor');
    expect(fake.calls[0].human).not.toContain('Prior documents');
    // reference threaded for fine-tuning log capture (document-scoped)
    expect(fake.calls[0].options?.reference).toEqual({
      organizationId: 'org-1',
      sourceType: 'document',
      sourceId: 'd1',
    });
  });
});
