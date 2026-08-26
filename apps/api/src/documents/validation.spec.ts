import type { DocumentMetadata } from '@nom/shared';
import { isValidFinancialDocument } from './validation';
import { buildDocumentContext } from './helpers/utils';

const meta = (over: Partial<DocumentMetadata>): DocumentMetadata => ({
  isFinancial: true,
  attributeSet: 'quotation',
  ...over,
});

describe('isValidFinancialDocument', () => {
  it('passes a financial source doc classified into a source set', () => {
    expect(isValidFinancialDocument(meta({}), 'source')).toBe(true);
  });

  it('rejects a non-financial doc', () => {
    expect(
      isValidFinancialDocument(meta({ isFinancial: false }), 'source'),
    ).toBe(false);
  });

  it('rejects when the attribute set belongs to a different documentType', () => {
    // 'invoice' is a transaction set — invalid for the source pipeline.
    expect(
      isValidFinancialDocument(meta({ attributeSet: 'invoice' }), 'source'),
    ).toBe(false);
  });

  it('rejects an unknown / null attribute set', () => {
    expect(
      isValidFinancialDocument(meta({ attributeSet: null }), 'source'),
    ).toBe(false);
    expect(
      isValidFinancialDocument(meta({ attributeSet: 'bogus' }), 'source'),
    ).toBe(false);
  });

  it('gates on the passed type, not the attribute set in isolation', () => {
    // A transaction-set doc validated as a source must reject.
    expect(
      isValidFinancialDocument(
        meta({ attributeSet: 'invoice' }),
        'transaction',
      ),
    ).toBe(true);
    expect(
      isValidFinancialDocument(meta({ attributeSet: 'invoice' }), 'source'),
    ).toBe(false);
  });
});

describe('buildDocumentContext', () => {
  it('joins only the present fields', () => {
    expect(
      buildDocumentContext(
        meta({
          documentKind: 'freight quotation',
          vendorName: 'Acme Forwarding',
          validFrom: '2026-01-01',
          validTo: '2026-12-31',
          currency: 'SGD',
          referenceNumbers: ['Q-123', 'Q-124'],
        }),
      ),
    ).toBe(
      'freight quotation · from Acme Forwarding · valid 2026-01-01–2026-12-31 · SGD · refs: Q-123, Q-124',
    );
  });

  it('skips empty fields and tolerates a one-sided date range', () => {
    expect(
      buildDocumentContext(
        meta({ documentKind: 'marine policy', validFrom: '2026-01-01' }),
      ),
    ).toBe('marine policy · valid 2026-01-01–?');
  });
});
