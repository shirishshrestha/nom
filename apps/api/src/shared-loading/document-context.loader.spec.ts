/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { jest } from '@jest/globals';
import { DOCUMENT_STATUSES } from '@nom/shared';
import { DocumentContextLoader } from './document-context.loader';
import { AttributeSetRegistry } from '../attribute-set';

const ORG = 'org-1';
const ID = 'doc-1';

function makeDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    organizationId: ORG,
    status: DOCUMENT_STATUSES.VALIDATED,
    attributeSet: 'quotation',
    fileId: 'file-1',
    ...overrides,
  };
}

function build(doc: unknown) {
  const documents = { findOneBy: jest.fn() } as any;
  const content = { find: jest.fn() } as any;
  const files = { findOneBy: jest.fn() } as any;
  documents.findOneBy.mockResolvedValue(doc);
  content.find.mockResolvedValue([{ id: 'c1', position: 0 }]);
  files.findOneBy.mockResolvedValue({ name: 'rates.pdf' });
  const loader = new DocumentContextLoader(
    documents,
    content,
    files,
    new AttributeSetRegistry(),
  );
  return { loader, documents, content, files };
}

describe('DocumentContextLoader', () => {
  it('requireDocument throws NotFound when missing', async () => {
    const { loader } = build(null);
    await expect(loader.requireDocument(ORG, ID)).rejects.toThrow(/not found/i);
  });

  it('loadSourceDoc rejects a non-validated document', async () => {
    const { loader } = build(makeDoc({ status: DOCUMENT_STATUSES.EXTRACTED }));
    await expect(loader.loadSourceDoc(ORG, ID)).rejects.toThrow(/validated/);
  });

  it('loadSourceDoc rejects a non-source attribute set', async () => {
    const { loader } = build(makeDoc({ attributeSet: 'invoice' }));
    await expect(loader.loadSourceDoc(ORG, ID)).rejects.toThrow(
      /not a source document/,
    );
  });

  it('loadSourceDoc returns the document + resolved set when valid', async () => {
    const { loader } = build(makeDoc());
    const { document, set } = await loader.loadSourceDoc(ORG, ID);
    expect(document.id).toBe(ID);
    expect(set.key).toBe('quotation');
  });

  it('loadSourceDoc allows a STAGED document (re-extraction)', async () => {
    const { loader } = build(makeDoc({ status: DOCUMENT_STATUSES.STAGED }));
    const { document } = await loader.loadSourceDoc(ORG, ID);
    expect(document.id).toBe(ID);
  });

  it("loadTransactionDoc loads a MATCHING or MATCHED doc (status is the match caller's concern)", async () => {
    for (const status of [
      DOCUMENT_STATUSES.MATCHING,
      DOCUMENT_STATUSES.MATCHED,
    ]) {
      const { loader } = build(makeDoc({ status, attributeSet: 'invoice' }));
      const { document, set } = await loader.loadTransactionDoc(ORG, ID);
      expect(document.status).toBe(status);
      expect(set.key).toBe('invoice');
    }
  });

  it('loadTransactionContext still rejects a non-extraction status (gate moved intact)', async () => {
    const { loader } = build(
      makeDoc({ status: DOCUMENT_STATUSES.MATCHED, attributeSet: 'invoice' }),
    );
    await expect(loader.loadTransactionContext(ORG, ID)).rejects.toThrow(
      /validated/,
    );
  });

  it('loadSourceContext adds ordered sections + originating file', async () => {
    const { loader, content } = build(makeDoc());
    const ctx = await loader.loadSourceContext(ORG, ID);
    expect(ctx.sections).toHaveLength(1);
    expect(ctx.file?.name).toBe('rates.pdf');
    // ordered by position ASC
    expect(content.find).toHaveBeenCalledWith(
      expect.objectContaining({ order: { position: 'ASC' } }),
    );
  });
});
