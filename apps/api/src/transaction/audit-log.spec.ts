import { logEntry, provenanceHeader } from './audit-log';

describe('audit-log', () => {
  it('provenanceHeader renders the origin line', () => {
    expect(
      provenanceHeader({
        documentId: 'doc-1',
        contentId: 'chunk-1',
        invoiceRef: 'INV-1',
        position: 2,
        extractor: 'transaction.line-item.extract@v5',
      }),
    ).toBe(
      'origin · doc=doc-1 · chunk=chunk-1 · invoice=INV-1 · pos=2 · extractor=transaction.line-item.extract@v5',
    );
  });

  it('logEntry prefixes an ISO timestamp', () => {
    const entry = logEntry('extracted');
    expect(entry).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z · extracted$/);
  });
});
