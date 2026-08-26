/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/unbound-method */
import { jest } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { DOCUMENT_STATUSES } from '@nom/shared';
import { ATTRIBUTE_SETS } from '../../attribute-set';
import { TEST_ORG_ID } from '../../testing/test-constants';
import type { DocumentContextLoader } from '../../shared-loading/document-context.loader';
import type { LineItemGraphRepository } from '../../infra/graph/line-item-graph.repository';
import type { CanonicalRegistryRepository } from '../../infra/graph/canonical-registry.repository';
import type { ServiceGraphRepository } from '../../infra/graph/service-graph.repository';
import type {
  LineItemMatcher,
  LineItemMatchResults,
} from './line-item-matcher';
import type { SymbolResolver } from './symbol-resolver';
import type { SiblingSymbolResolver } from './sibling-symbol-resolver';
import type { ReferencedExpressionComposer } from './referenced-expression-composer';
import { AmountReconciler } from './amount-reconciler';
import { TransactionMatchFlow } from './match-line-items.flow';

const asyncFn = () => jest.fn<(...args: any[]) => Promise<any>>();

function build(docStatus: string = DOCUMENT_STATUSES.COMMITTED) {
  const document = {
    id: 'doc-1',
    vendorId: 'vendor-1',
    status: docStatus,
    metadata: { isFinancial: true, attributeSet: 'invoice' },
  };

  const loader = {
    loadTransactionDoc: asyncFn(),
  } as unknown as jest.Mocked<DocumentContextLoader>;
  (loader.loadTransactionDoc as any).mockResolvedValue({
    document,
    set: ATTRIBUTE_SETS.invoice,
  });

  const matcher = {
    match: asyncFn(),
  } as unknown as jest.Mocked<LineItemMatcher>;

  const resolver = {
    resolve: asyncFn(),
  } as unknown as jest.Mocked<SymbolResolver>;
  (resolver.resolve as any).mockResolvedValue([]);

  const siblingResolver = {
    resolve: asyncFn(),
  } as unknown as jest.Mocked<SiblingSymbolResolver>;
  (siblingResolver.resolve as any).mockResolvedValue([]);

  const composer = {
    compose: asyncFn(),
  } as unknown as jest.Mocked<ReferencedExpressionComposer>;
  (composer.compose as any).mockResolvedValue([]);

  const lineItemGraph = {
    writeMatchResults: asyncFn(),
    writeResolvedSymbols: asyncFn(),
    writeReconciliation: asyncFn(),
    listForDocument: asyncFn(),
    listForSectionOf: asyncFn(),
  } as unknown as jest.Mocked<LineItemGraphRepository>;
  (lineItemGraph.writeMatchResults as any).mockResolvedValue({});
  (lineItemGraph.writeResolvedSymbols as any).mockResolvedValue(0);
  (lineItemGraph.writeReconciliation as any).mockResolvedValue(0);
  (lineItemGraph.listForDocument as any).mockResolvedValue([]);
  (lineItemGraph.listForSectionOf as any).mockResolvedValue([]);

  const canonicalRegistry = {
    findForVendor: asyncFn(),
    tiersForVendor: asyncFn(),
  } as unknown as jest.Mocked<CanonicalRegistryRepository>;
  (canonicalRegistry.findForVendor as any).mockResolvedValue([]);
  (canonicalRegistry.tiersForVendor as any).mockResolvedValue([]);

  const serviceGraph = {
    listCurrentForVendor: asyncFn(),
    listServicesForCanonicals: asyncFn(),
    listPricingRefs: asyncFn(),
  } as unknown as jest.Mocked<ServiceGraphRepository>;
  (serviceGraph.listCurrentForVendor as any).mockResolvedValue({
    groupedServices: [],
    attributeSet: null,
    total: 0,
  });
  (serviceGraph.listServicesForCanonicals as any).mockResolvedValue([]);
  // Default: no cross-service pricing references (empty edge set).
  (serviceGraph.listPricingRefs as any).mockResolvedValue([]);

  const pipelineLog = { append: asyncFn() } as any;
  pipelineLog.append.mockResolvedValue(undefined);
  const pipelineReasoning = { upsert: asyncFn() } as any;
  pipelineReasoning.upsert.mockResolvedValue(undefined);

  const rulesService = {
    rulesFor: asyncFn(),
    markRulesApplied: asyncFn(),
  } as any;
  rulesService.rulesFor.mockResolvedValue(undefined);
  rulesService.markRulesApplied.mockResolvedValue(undefined);

  const narrativeGenerator = { generate: asyncFn() } as any;
  narrativeGenerator.generate.mockResolvedValue(new Map());

  const flow = new TransactionMatchFlow(
    loader,
    matcher,
    resolver,
    siblingResolver,
    composer,
    new AmountReconciler(),
    narrativeGenerator,
    lineItemGraph,
    canonicalRegistry,
    serviceGraph,
    pipelineLog,
    pipelineReasoning,
    rulesService,
  );
  return {
    flow,
    loader,
    matcher,
    resolver,
    siblingResolver,
    lineItemGraph,
    canonicalRegistry,
    serviceGraph,
    pipelineLog,
    pipelineReasoning,
  };
}

describe('TransactionMatchFlow', () => {
  it('rejects a document that is not committed', async () => {
    const { flow, lineItemGraph } = build(DOCUMENT_STATUSES.EXTRACTED);
    await expect(flow.run(TEST_ORG_ID, 'doc-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(lineItemGraph.listForDocument).not.toHaveBeenCalled();
  });

  it('returns zero counts without matching when there are no line items', async () => {
    const { flow, matcher, lineItemGraph } = build();
    (lineItemGraph.listForDocument as any).mockResolvedValue([]);

    const res = await flow.run(TEST_ORG_ID, 'doc-1');
    expect(res).toEqual({
      documentId: 'doc-1',
      serviceMatchCount: 0,
      siblingRefCount: 0,
      unmatchedCount: 0,
    });
    expect(matcher.match).not.toHaveBeenCalled();
    expect(lineItemGraph.writeMatchResults).not.toHaveBeenCalled();
  });

  it('writes match results and returns the per-kind counts', async () => {
    const { flow, matcher, lineItemGraph } = build();
    (lineItemGraph.listForDocument as any).mockResolvedValue([
      { id: 'li-1', attributes: {} },
    ]);
    const results: LineItemMatchResults = {
      rows: [
        {
          id: 'li-1',
          matchKind: 'service_match',
          reasoning: {
            kind: '',
            canonical: '',
            tier: '',
            references: '',
            formula: '',
          },
          log: [],
          formula: null,
          symbols: null,
        },
      ],
      serviceMatches: [
        {
          lineItemId: 'li-1',
          canonicalName: 'local_haulage',
          tierSlug: '40ft',
        },
      ],
      references: [],
      counts: { serviceMatch: 1, siblingRef: 0, unmatched: 0 },
    };
    (matcher.match as any).mockResolvedValue(results);

    const res = await flow.run(TEST_ORG_ID, 'doc-1');
    expect(lineItemGraph.writeMatchResults).toHaveBeenCalledTimes(1);
    expect(res).toEqual({
      documentId: 'doc-1',
      serviceMatchCount: 1,
      siblingRefCount: 0,
      unmatchedCount: 0,
    });
  });

  it('skips symbol resolution but still verdicts unmatched lines needs_review', async () => {
    const { flow, matcher, lineItemGraph, serviceGraph, resolver } = build();
    (lineItemGraph.listForDocument as any).mockResolvedValue([
      { id: 'li-1', attributes: { amount: 42 } },
    ]);
    (matcher.match as any).mockResolvedValue({
      rows: [
        {
          id: 'li-1',
          matchKind: 'unmatched',
          log: [],
          formula: null,
          symbols: null,
        },
      ],
      serviceMatches: [],
      references: [],
      counts: { serviceMatch: 0, siblingRef: 0, unmatched: 1 },
    });

    await flow.run(TEST_ORG_ID, 'doc-1');
    expect(serviceGraph.listCurrentForVendor).not.toHaveBeenCalled();
    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(lineItemGraph.writeResolvedSymbols).not.toHaveBeenCalled();
    // No line leaves the flow without a status.
    expect(lineItemGraph.writeReconciliation).toHaveBeenCalledTimes(1);
    const { rows } = (lineItemGraph.writeReconciliation as any).mock
      .calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'li-1',
      status: 'needs_review',
      expectedAmount: null,
      billedAmount: 42,
      reviewNote: 'Needs context: no rate-card service matched',
    });
  });

  it('threads the adjudicator-corrected formula into resolution and the match write', async () => {
    const { flow, matcher, lineItemGraph, resolver } = build();
    (lineItemGraph.listForDocument as any).mockResolvedValue([
      {
        id: 'li-1',
        description: 'Haulage',
        attributes: { amount: 200 },
        formula: 'rate * quantity +', // malformed original
        symbols: { rate: null, quantity: 2 },
      },
    ]);
    (matcher.match as any).mockResolvedValue({
      rows: [
        {
          id: 'li-1',
          matchKind: 'service_match',
          reasoning: {},
          log: [],
          // adjudicator's accepted, corrected values
          formula: 'rate * quantity * (1 + gst)',
          symbols: { rate: null, quantity: 2, gst: null },
        },
      ],
      serviceMatches: [
        {
          lineItemId: 'li-1',
          canonicalName: 'local_haulage',
          tierSlug: '40ft',
        },
      ],
      references: [],
      counts: { serviceMatch: 1, siblingRef: 0, unmatched: 0 },
    });

    await flow.run(TEST_ORG_ID, 'doc-1');

    // The corrected formula + redeclared (null) symbol reach phase-3 resolution.
    const [, resolvable] = (resolver.resolve as any).mock.calls[0];
    expect(resolvable[0]).toMatchObject({
      id: 'li-1',
      formula: 'rate * quantity * (1 + gst)',
      symbols: { rate: null, quantity: 2, gst: null },
    });

    // ...and get persisted (symbols JSON-serialized) on the match write.
    const [writeArg] = (lineItemGraph.writeMatchResults as any).mock.calls[0];
    expect(writeArg.rows[0]).toEqual({
      id: 'li-1',
      matchKind: 'service_match',
      formula: 'rate * quantity * (1 + gst)',
      symbols: JSON.stringify({ rate: null, quantity: 2, gst: null }),
    });
  });

  it('resolves and reconciles sibling_ref lines from their referenced siblings', async () => {
    const { flow, matcher, siblingResolver, lineItemGraph } = build();
    (lineItemGraph.listForDocument as any).mockResolvedValue([
      { id: 'li-1', description: 'PSA charge', attributes: { amount: 100 } },
      {
        id: 'li-2',
        description: 'Admin fee 5% of PSA',
        formula: 'base * pct',
        symbols: { base: null, pct: 0.05 },
        attributes: { amount: 5 },
      },
    ]);
    (matcher.match as any).mockResolvedValue({
      rows: [
        {
          id: 'li-1',
          matchKind: 'unmatched',
          reasoning: {},
          log: [],
          formula: null,
          symbols: null,
        },
        {
          id: 'li-2',
          matchKind: 'sibling_ref',
          reasoning: {},
          log: [],
          formula: 'base * pct',
          symbols: { base: null, pct: 0.05 },
        },
      ],
      serviceMatches: [],
      references: [{ fromId: 'li-2', toId: 'li-1' }],
      counts: { serviceMatch: 0, siblingRef: 1, unmatched: 1 },
    });
    (siblingResolver.resolve as any).mockResolvedValue([
      { id: 'li-2', symbols: { base: 100, pct: 0.05 }, logAdditions: [] },
    ]);

    await flow.run(TEST_ORG_ID, 'doc-1');

    // The sibling resolver got the referenced sibling with its billed amount.
    const [, resolvable] = (siblingResolver.resolve as any).mock.calls[0];
    expect(resolvable).toEqual([
      expect.objectContaining({
        id: 'li-2',
        references: [
          { id: 'li-1', description: 'PSA charge', billedAmount: 100 },
        ],
      }),
    ]);
    expect(lineItemGraph.writeResolvedSymbols).toHaveBeenCalledTimes(1);

    // li-2 evaluates 100 * 0.05 = 5 == billed → match; li-1 (unmatched) → needs_review.
    const { rows } = (lineItemGraph.writeReconciliation as any).mock
      .calls[0][0];
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'li-2',
          status: 'match',
          expectedAmount: 5,
          billedAmount: 5,
        }),
        expect.objectContaining({
          id: 'li-1',
          status: 'needs_review',
          billedAmount: 100,
          reviewNote: 'Needs context: no rate-card service matched',
        }),
      ]),
    );
  });

  it('resolves an unmatched line from its guidance and reconciles it', async () => {
    const { flow, matcher, resolver, lineItemGraph } = build();
    (lineItemGraph.listForDocument as any).mockResolvedValue([
      {
        id: 'li-1',
        description: 'Special handling',
        formula: 'rate * quantity',
        symbols: { rate: null, quantity: 2 },
        attributes: { amount: 100 },
        guidance: 'the contracted rate for this charge is 50',
      },
    ]);
    (matcher.match as any).mockResolvedValue({
      rows: [
        {
          id: 'li-1',
          matchKind: 'unmatched',
          reasoning: {},
          log: [],
          formula: 'rate * quantity',
          symbols: { rate: null, quantity: 2 },
        },
      ],
      serviceMatches: [],
      references: [],
      counts: { serviceMatch: 0, siblingRef: 0, unmatched: 1 },
    });
    (resolver.resolve as any).mockResolvedValue([
      { id: 'li-1', symbols: { rate: 50, quantity: 2 }, logAdditions: [] },
    ]);

    await flow.run(TEST_ORG_ID, 'doc-1');

    // The unmatched-but-guided line reached the resolver, carrying its guidance.
    const [, resolvable] = (resolver.resolve as any).mock.calls[0];
    expect(resolvable).toEqual([
      expect.objectContaining({
        id: 'li-1',
        canonicalName: null,
        guidance: 'the contracted rate for this charge is 50',
      }),
    ]);
    // 50 * 2 = 100 == billed → a real verdict, not the needs_review backfill.
    const { rows } = (lineItemGraph.writeReconciliation as any).mock
      .calls[0][0];
    expect(rows).toEqual([
      expect.objectContaining({
        id: 'li-1',
        status: 'match',
        expectedAmount: 100,
        billedAmount: 100,
      }),
    ]);
  });

  it('runForLine loads the target section, adjudicates it whole, writes only the target', async () => {
    const { flow, matcher, lineItemGraph } = build();
    // The section: the targeted sibling_ref line plus the sibling it is computed from.
    (lineItemGraph.listForSectionOf as any).mockResolvedValue([
      { id: 'li-1', description: 'PSA charge', attributes: { amount: 100 } },
      {
        id: 'li-2',
        description: 'Admin fee 5% of PSA',
        formula: 'base * pct',
        symbols: { base: null, pct: 0.05 },
        attributes: { amount: 5 },
      },
    ]);
    (matcher.match as any).mockResolvedValue({
      rows: [
        {
          id: 'li-1',
          matchKind: 'unmatched',
          reasoning: {},
          log: [],
          formula: null,
          symbols: null,
        },
        {
          id: 'li-2',
          matchKind: 'sibling_ref',
          reasoning: {},
          log: [],
          formula: 'base * pct',
          symbols: { base: null, pct: 0.05 },
        },
      ],
      serviceMatches: [],
      references: [{ fromId: 'li-2', toId: 'li-1' }],
      counts: { serviceMatch: 0, siblingRef: 1, unmatched: 1 },
    });

    const res = await flow.runForLine(TEST_ORG_ID, 'doc-1', 'li-2');

    // Loaded the section, not the whole document.
    expect(lineItemGraph.listForSectionOf).toHaveBeenCalledWith(
      TEST_ORG_ID,
      'doc-1',
      'li-2',
    );
    expect(lineItemGraph.listForDocument).not.toHaveBeenCalled();
    // The model saw BOTH section lines (so the sibling ref can resolve).
    const [, adjudicated] = (matcher.match as any).mock.calls[0];
    expect(adjudicated.map((l: any) => l.id)).toEqual(['li-1', 'li-2']);
    // But only the targeted line was written / verdicted.
    const [writeArg] = (lineItemGraph.writeMatchResults as any).mock.calls[0];
    expect(writeArg.rows.map((row: any) => row.id)).toEqual(['li-2']);
    const { rows } = (lineItemGraph.writeReconciliation as any).mock
      .calls[0][0];
    expect(rows.map((row: any) => row.id)).toEqual(['li-2']);
    expect(res).toEqual({
      documentId: 'doc-1',
      serviceMatchCount: 0,
      siblingRefCount: 1,
      unmatchedCount: 0,
    });
  });
});
