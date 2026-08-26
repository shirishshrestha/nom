/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { jest } from '@jest/globals';
import { DOCUMENT_STATUSES, type LineItem } from '@nom/shared';
import { ATTRIBUTE_SETS } from '../../attribute-set';
import { TEST_SESSION } from '../../testing/test-constants';
import type { DocumentContextLoader } from '../../shared-loading/document-context.loader';
import type { LineItemExtractor } from './line-item-extractor';
import type { LineItemGraphRepository } from '../../infra/graph/line-item-graph.repository';
import type { CanonicalRegistryRepository } from '../../infra/graph/canonical-registry.repository';
import { TransactionExtractFlow } from './extract-line-items.flow';

const asyncFn = () => jest.fn<(...args: any[]) => Promise<any>>();
const session = TEST_SESSION as any;

function sampleLineItem(): LineItem {
  return {
    id: 'li-1',
    description: 'Truck',
    invoiceRef: 'INV-1',
    sectionLabel: 'INV-1',
    attributes: { amount: 220 },
    taxable: true,
    taxPercentage: 9,
    formula: 'rate * qty',
    symbols: { rate: null, qty: 1 },
    initialKind: 'service_match',
    initialCanonical: 'local_haulage',
    initialTierSlug: '40ft',
    initialRefSummary: null,
    meta: {
      foundAt: 'l1',
      sourceText: 'src',
      contentId: 'c1',
      position: 0,
      sectionContext: null,
    },
    log: ['origin · li-1'],
  };
}

function build() {
  const document = {
    id: 'doc-1',
    vendorId: 'vendor-1',
    metadata: {
      isFinancial: true,
      attributeSet: 'invoice',
      summary: 'March freight billing',
    },
  };

  const documentsRepo = { update: asyncFn() } as any;
  documentsRepo.update.mockResolvedValue(undefined);

  const loader = {
    loadTransactionContext: asyncFn(),
  } as unknown as jest.Mocked<DocumentContextLoader>;
  (loader.loadTransactionContext as any).mockResolvedValue({
    document,
    set: ATTRIBUTE_SETS.invoice,
    sections: [],
    file: { name: 'invoice.pdf' },
  });

  const extractor = {
    extract: asyncFn(),
  } as unknown as jest.Mocked<LineItemExtractor>;
  (extractor.extract as any).mockResolvedValue([sampleLineItem()]);

  const canonicalRegistry = {
    findForVendor: asyncFn(),
    tiersForVendor: asyncFn(),
  } as unknown as jest.Mocked<CanonicalRegistryRepository>;
  (canonicalRegistry.findForVendor as any).mockResolvedValue([]);
  (canonicalRegistry.tiersForVendor as any).mockResolvedValue([]);

  const lineItemGraph = {
    writeLineItems: asyncFn(),
  } as unknown as jest.Mocked<LineItemGraphRepository>;
  (lineItemGraph.writeLineItems as any).mockResolvedValue(1);

  const pipelineLog = { append: asyncFn() } as any;
  pipelineLog.append.mockResolvedValue(undefined);

  const rulesService = {
    rulesFor: asyncFn(),
    markRulesApplied: asyncFn(),
  } as any;
  rulesService.rulesFor.mockResolvedValue(undefined);
  rulesService.markRulesApplied.mockResolvedValue(undefined);

  const flow = new TransactionExtractFlow(
    documentsRepo,
    loader,
    extractor,
    canonicalRegistry,
    lineItemGraph,
    pipelineLog,
    rulesService,
  );
  return {
    flow,
    documentsRepo,
    loader,
    extractor,
    canonicalRegistry,
    lineItemGraph,
    pipelineLog,
    rulesService,
  };
}

describe('TransactionExtractFlow', () => {
  it('flips status PROCESSING → COMMITTED and returns the extracted DTO', async () => {
    const { flow, documentsRepo } = build();
    const res = await flow.run(session, 'doc-1');

    expect(documentsRepo.update).toHaveBeenCalledTimes(2);
    expect(documentsRepo.update.mock.calls[0][1]).toEqual({
      status: DOCUMENT_STATUSES.PROCESSING,
    });
    expect(documentsRepo.update.mock.calls[1][1]).toEqual({
      status: DOCUMENT_STATUSES.COMMITTED,
    });
    expect(res.status).toBe(DOCUMENT_STATUSES.COMMITTED);
    expect(res.fileName).toBe('invoice.pdf');
    expect(res.lineItems).toHaveLength(1);
    expect(res.lineItems[0].id).toBe('li-1');
    expect(res.lineItems[0].status).toBeNull();
  });

  it('threads the document metadata into the extractor', async () => {
    const { flow, extractor } = build();
    await flow.run(session, 'doc-1');

    const metaArg = (extractor.extract as any).mock.calls[0][4];
    expect(metaArg).toEqual({
      isFinancial: true,
      attributeSet: 'invoice',
      summary: 'March freight billing',
    });
  });

  it('selects extraction rules by the section text, not the doc summary', async () => {
    const { flow, loader, rulesService } = build();
    (loader.loadTransactionContext as any).mockResolvedValue({
      document: {
        id: 'doc-1',
        vendorId: 'vendor-1',
        metadata: {
          isFinancial: true,
          attributeSet: 'invoice',
          summary: 'March freight billing',
        },
      },
      set: ATTRIBUTE_SETS.invoice,
      sections: [{ label: 'Charges', text: 'Tuas Mega Port Surcharge 12.00' }],
      file: { name: 'invoice.pdf' },
    });

    await flow.run(session, 'doc-1');

    const contextText = rulesService.rulesFor.mock.calls[0][3];
    expect(contextText).toContain('Tuas Mega Port Surcharge');
    expect(contextText).not.toBe('March freight billing');
  });

  it('JSON-serializes symbols in the graph write payload', async () => {
    const { flow, lineItemGraph } = build();
    await flow.run(session, 'doc-1');

    const arg = (lineItemGraph.writeLineItems as any).mock.calls[0][0];
    expect(arg.rows[0].symbols).toBe('{"rate":null,"qty":1}');
  });
});
