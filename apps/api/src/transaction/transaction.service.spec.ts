/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/unbound-method */
import { jest } from '@jest/globals';
import { TEST_ORG_ID, TEST_SESSION } from '../testing/test-constants';
import type { LineItemGraphRepository } from '../infra/graph/line-item-graph.repository';
import type { TransactionExtractFlow } from './extraction/extract-line-items.flow';
import type { TransactionMatchFlow } from './matching/match-line-items.flow';
import type { PipelineLogRepository } from './persistence/pipeline-log.repository';
import type { PipelineReasoningRepository } from './persistence/pipeline-reasoning.repository';
import { TransactionService } from './transaction.service';

const asyncFn = () => jest.fn<(...args: any[]) => Promise<any>>();
const session = TEST_SESSION as any;

function build() {
  const lineItemGraph = {
    listForDocument: asyncFn(),
  } as unknown as jest.Mocked<LineItemGraphRepository>;
  (lineItemGraph.listForDocument as any).mockResolvedValue([]);

  const extractFlow = {
    run: asyncFn(),
  } as unknown as jest.Mocked<TransactionExtractFlow>;
  (extractFlow.run as any).mockResolvedValue({ documentId: 'doc-1' });

  const matchFlow = {
    run: asyncFn(),
  } as unknown as jest.Mocked<TransactionMatchFlow>;
  (matchFlow.run as any).mockResolvedValue({
    documentId: 'doc-1',
    serviceMatchCount: 0,
    siblingRefCount: 0,
    unmatchedCount: 0,
  });

  const pipelineLog = {
    listForEntity: asyncFn(),
  } as unknown as jest.Mocked<PipelineLogRepository>;
  (pipelineLog.listForEntity as any).mockResolvedValue([]);

  const pipelineReasoning = {
    listForDocument: asyncFn(),
  } as unknown as jest.Mocked<PipelineReasoningRepository>;
  (pipelineReasoning.listForDocument as any).mockResolvedValue(new Map());

  const matchQueue = { add: asyncFn() } as any;
  matchQueue.add.mockResolvedValue(undefined);
  const documentsRepo = { update: asyncFn(), findOneBy: asyncFn() } as any;
  documentsRepo.update.mockResolvedValue(undefined);
  documentsRepo.findOneBy.mockResolvedValue(null);

  const service = new TransactionService(
    lineItemGraph,
    extractFlow,
    matchFlow,
    pipelineLog,
    pipelineReasoning,
    matchQueue,
    documentsRepo,
  );
  return {
    service,
    lineItemGraph,
    extractFlow,
    matchFlow,
    pipelineLog,
    pipelineReasoning,
    matchQueue,
    documentsRepo,
  };
}

describe('TransactionService', () => {
  describe('extractLineItems', () => {
    it('delegates to the extract flow and returns its result', async () => {
      const { service, extractFlow } = build();
      const res = await service.extractLineItems(session, 'doc-1');
      expect(extractFlow.run).toHaveBeenCalledWith(session, 'doc-1');
      expect(res).toEqual({ documentId: 'doc-1' });
    });
  });

  describe('matchLineItems', () => {
    const prev = process.env.TRANSACTION_MATCH_ASYNC;
    afterEach(() => {
      if (prev === undefined) delete process.env.TRANSACTION_MATCH_ASYNC;
      else process.env.TRANSACTION_MATCH_ASYNC = prev;
    });

    it('runs the match flow inline (sync) by default and returns its counts', async () => {
      delete process.env.TRANSACTION_MATCH_ASYNC;
      const { service, matchFlow, matchQueue } = build();
      const res = await service.matchLineItems(session, 'doc-1');
      expect(matchFlow.run).toHaveBeenCalledWith(TEST_ORG_ID, 'doc-1');
      expect(matchQueue.add).not.toHaveBeenCalled();
      expect(res).toEqual({
        documentId: 'doc-1',
        serviceMatchCount: 0,
        siblingRefCount: 0,
        unmatchedCount: 0,
      });
    });

    it('flips the doc to matching and enqueues (no inline run) when async is on', async () => {
      process.env.TRANSACTION_MATCH_ASYNC = 'true';
      const { service, matchFlow, matchQueue, documentsRepo } = build();
      const res = await service.matchLineItems(session, 'doc-1');
      expect(matchFlow.run).not.toHaveBeenCalled();
      expect(documentsRepo.update).toHaveBeenCalledWith(
        { id: 'doc-1', organizationId: TEST_ORG_ID },
        { status: 'matching' },
      );
      expect(matchQueue.add).toHaveBeenCalledWith('match', {
        organizationId: TEST_ORG_ID,
        documentId: 'doc-1',
      });
      expect(res).toEqual({ documentId: 'doc-1', status: 'matching' });
    });
  });

  describe('getLineItems', () => {
    it('maps graph line items, merges reasoning inline, and omits the log', async () => {
      const { service, lineItemGraph, pipelineReasoning } = build();
      (lineItemGraph.listForDocument as any).mockResolvedValue([
        { id: 'li-1', description: 'PSA', references: [] },
      ]);
      (pipelineReasoning.listForDocument as any).mockResolvedValue(
        new Map([['li-1', { kind: 'service_match' }]]),
      );

      const res = await service.getLineItems(TEST_ORG_ID, 'doc-1');
      expect(res.documentId).toBe('doc-1');
      const [row] = res.lineItems;
      expect(row.id).toBe('li-1');
      // log is served on demand, never in the list response
      expect(row).not.toHaveProperty('log');
      // reasoning is merged inline as the structured object
      expect(row.matchReasoning).toEqual({ kind: 'service_match' });
    });

    it('groups a service_match line into the reconciliation panels with an overcharge narrative', async () => {
      const { service, lineItemGraph } = build();
      (lineItemGraph.listForDocument as any).mockResolvedValue([
        {
          id: 'li-1',
          description: 'Marine Cargo Premium',
          status: 'mismatch',
          matchKind: 'service_match',
          expectedAmount: 140,
          billedAmount: 185,
          formula: 'sum_insured * rate / 100',
          symbols: { sum_insured: 350000, rate: 0.04 },
          matchedCanonicalName: 'ordinary_risks',
          matchedTierSlug: 'main_voyage_foodstuffs',
          matchedTier: 'Main voyage — foodstuffs',
          matchedPricingContext: '0.04% of insured value',
          matchedServiceAttributes: { premium: 0.04, currency: 'USD' },
          references: [],
        },
      ]);

      const [row] = (await service.getLineItems(TEST_ORG_ID, 'doc-1'))
        .lineItems;
      expect(row.reconciliation).toEqual({
        expectedAmount: 140,
        billedAmount: 185,
        difference: 45,
        direction: 'over',
      });
      expect(row.fromQuotation).toEqual({
        canonicalName: 'ordinary_risks',
        tierSlug: 'main_voyage_foodstuffs',
        tier: 'Main voyage — foodstuffs',
        pricingContext: '0.04% of insured value',
        attributes: { premium: 0.04, currency: 'USD' },
      });
      expect(row.howDetermined).toMatchObject({
        formula: 'sum_insured * rate / 100',
        symbols: { sum_insured: 350000, rate: 0.04 },
        difference: 45,
      });
      expect(row.narrative).toContain('overcharged');
    });

    it('surfaces the service title and strips internal keys from the attribute bags', async () => {
      const { service, lineItemGraph } = build();
      (lineItemGraph.listForDocument as any).mockResolvedValue([
        {
          id: 'li-1',
          description: 'Marine Cargo Premium',
          status: 'mismatch',
          matchKind: 'service_match',
          attributes: { amount: 185, tenantId: 't-1', attributeSet: 'invoice' },
          matchedCanonicalName: 'ordinary_risks',
          matchedTierSlug: 'main_voyage',
          matchedTier: 'Main voyage',
          matchedServiceTitle: 'Marine Cargo — Ordinary Risks',
          matchedPricingContext: '0.04% of insured value',
          matchedServiceAttributes: {
            premium: 0.04,
            currency: 'USD',
            tenantId: 't-1',
            serviceId: 's-9',
            attributeSet: 'insurance',
          },
          references: [],
        },
      ]);

      const [row] = (await service.getLineItems(TEST_ORG_ID, 'doc-1'))
        .lineItems;
      // top-level bag: internal plumbing keys gone, real values kept
      expect(row.attributes).toEqual({ amount: 185 });
      // fromQuotation: title surfaced, internal keys stripped, priced attrs kept
      expect(row.fromQuotation?.title).toBe('Marine Cargo — Ordinary Risks');
      expect(row.fromQuotation?.attributes).toEqual({
        premium: 0.04,
        currency: 'USD',
      });
    });

    it('leaves the quotation/formula panels null on an unmatched line and uses the review note as narrative', async () => {
      const { service, lineItemGraph } = build();
      (lineItemGraph.listForDocument as any).mockResolvedValue([
        {
          id: 'li-2',
          description: 'Mystery charge',
          status: 'needs_review',
          matchKind: 'unmatched',
          expectedAmount: null,
          billedAmount: 100,
          formula: null,
          symbols: null,
          matchedCanonicalName: null,
          matchedServiceAttributes: null,
          reviewNote: 'Needs context: no rate-card service matched',
          references: [],
        },
      ]);

      const [row] = (await service.getLineItems(TEST_ORG_ID, 'doc-1'))
        .lineItems;
      expect(row.fromQuotation).toBeNull();
      expect(row.howDetermined).toBeNull();
      expect(row.reconciliation.direction).toBeNull();
      expect(row.narrative).toBe('Needs context: no rate-card service matched');
    });
  });

  describe('getMatchStatus', () => {
    it('returns the document id + current status + reviewStatus', async () => {
      const { service, documentsRepo } = build();
      documentsRepo.findOneBy.mockResolvedValue({ status: 'matching' });

      const res = await service.getMatchStatus(session, 'doc-1');
      expect(documentsRepo.findOneBy).toHaveBeenCalledWith({
        id: 'doc-1',
        organizationId: TEST_ORG_ID,
        documentType: 'transaction',
      });
      // review not marked done → Pending (independent of matching)
      expect(res).toEqual({
        documentId: 'doc-1',
        status: 'matching',
        reviewStatus: 'Pending',
      });
    });

    it('reports Completed once the review is marked done', async () => {
      const { service, documentsRepo } = build();
      documentsRepo.findOneBy.mockResolvedValue({
        status: 'matched',
        reviewCompleted: true,
      });

      const res = await service.getMatchStatus(session, 'doc-1');
      expect(res).toEqual({
        documentId: 'doc-1',
        status: 'matched',
        reviewStatus: 'Completed',
      });
    });

    it('throws NotFound when the document is absent', async () => {
      const { service, documentsRepo } = build();
      documentsRepo.findOneBy.mockResolvedValue(null);

      await expect(service.getMatchStatus(session, 'missing')).rejects.toThrow(
        /not found/i,
      );
    });
  });

  describe('getLineItemLog', () => {
    it('returns the on-demand audit trail for one line item', async () => {
      const { service, pipelineLog } = build();
      (pipelineLog.listForEntity as any).mockResolvedValue(['a', 'b']);

      const res = await service.getLineItemLog(TEST_ORG_ID, 'li-1');
      expect(res).toEqual({ lineItemId: 'li-1', log: ['a', 'b'] });
    });
  });
});
