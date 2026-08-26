/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { jest } from '@jest/globals';
import { DashboardService } from './dashboard.service';
import { TEST_SESSION } from '../testing/test-constants';
import type { OrgSession } from '../auth/auth.types';
import type {
  TenantLineItemStats,
  TenantWindowStats,
} from '../infra/graph/line-item-graph.repository';

const session = TEST_SESSION as OrgSession;
const asyncFn = () => jest.fn<(...args: any[]) => Promise<any>>();

const ZERO_WINDOW: TenantWindowStats = {
  adjudicated: 0,
  matchCount: 0,
  mismatchCount: 0,
  needsReviewCount: 0,
  overchargeSum: 0,
  documentCount: 0,
};

// Card values read from `current`; `prior` (defaults to an empty window) is the trend baseline.
function stats(
  current: Partial<TenantWindowStats>,
  prior: Partial<TenantWindowStats> = {},
): TenantLineItemStats {
  return {
    current: { ...ZERO_WINDOW, ...current },
    prior: { ...ZERO_WINDOW, ...prior },
  };
}

function build(
  data: TenantLineItemStats = stats({}),
  counts = { vendor: 0, quotation: 0, transaction: 0 },
) {
  const lineItemGraph = { getTenantStats: asyncFn() } as any;
  lineItemGraph.getTenantStats.mockResolvedValue(data);

  // documentsRepo.count is called twice: source (quotation) then transaction, in order.
  const documentsRepo = { count: asyncFn() } as any;
  documentsRepo.count
    .mockResolvedValueOnce(counts.quotation)
    .mockResolvedValueOnce(counts.transaction);

  const vendorsRepo = { count: asyncFn() } as any;
  vendorsRepo.count.mockResolvedValue(counts.vendor);

  const service = new DashboardService(
    lineItemGraph,
    documentsRepo,
    vendorsRepo,
  );
  return { service, lineItemGraph, documentsRepo, vendorsRepo };
}

describe('DashboardService', () => {
  it('sums positive overcharges into the overcharges card', async () => {
    const { service } = build(
      stats({
        overchargeSum: 18290.5,
        documentCount: 3,
        adjudicated: 3,
        matchCount: 3,
      }),
    );
    const res = await service.getDashboard(session);
    expect(res.overcharges.amount).toBe(18290.5);
    expect(res.overcharges.trendPercent).toBeNull();
  });

  it('computes verification accuracy as match / adjudicated (percent)', async () => {
    const { service } = build(
      stats({ adjudicated: 289, matchCount: 260, documentCount: 10 }),
    );
    const res = await service.getDashboard(session);
    expect(res.verification.percent).toBe(89.97); // 260/289*100 rounded
    expect(res.verification.lineItemsVerified).toBe(260);
    expect(res.verification.totalLineItems).toBe(289);
    expect(res.verification.invoiceCount).toBe(10);
  });

  it('counts exceptions as mismatch + needs_review', async () => {
    const { service } = build(
      stats({
        mismatchCount: 30,
        needsReviewCount: 15,
        adjudicated: 100,
        matchCount: 55,
        documentCount: 10,
      }),
    );
    const res = await service.getDashboard(session);
    expect(res.exceptions.count).toBe(45);
  });

  it('averages flags per document', async () => {
    const { service } = build(
      stats({
        mismatchCount: 30,
        needsReviewCount: 15,
        documentCount: 10,
        adjudicated: 100,
        matchCount: 55,
      }),
    );
    const res = await service.getDashboard(session);
    expect(res.averageFlagsPerFile.value).toBe(4.5); // 45 / 10
  });

  it('returns zeros without dividing by zero on an empty graph', async () => {
    const { service } = build();
    const res = await service.getDashboard(session);
    expect(res.verification.percent).toBe(0);
    expect(res.averageFlagsPerFile.value).toBe(0);
    expect(res.exceptions.count).toBe(0);
    expect(res.overcharges.amount).toBe(0);
    expect(Number.isNaN(res.verification.percent)).toBe(false);
  });

  it('computes overcharge trend vs the prior 30-day window', async () => {
    const { service } = build(
      stats({ overchargeSum: 150 }, { overchargeSum: 100 }),
    );
    const res = await service.getDashboard(session);
    expect(res.overcharges.previousAmount).toBe(100);
    expect(res.overcharges.trendPercent).toBe(50); // (150-100)/100*100
  });

  it('leaves trendPercent null when the prior window is empty', async () => {
    const { service } = build(
      stats({ overchargeSum: 150, mismatchCount: 3, documentCount: 1 }),
    );
    const res = await service.getDashboard(session);
    expect(res.overcharges.trendPercent).toBeNull();
    expect(res.exceptions.trendPercent).toBeNull();
    expect(res.averageFlagsPerFile.trendPercent).toBeNull();
    expect(res.verification.trendPercent).toBeNull();
  });

  it('derives upload-card status flags from the entity counts', async () => {
    const { service } = build(stats({}), {
      vendor: 2,
      quotation: 0,
      transaction: 5,
    });
    const res = await service.getDashboard(session);
    expect(res.status).toEqual({
      hasVendors: true,
      hasQuotations: false,
      hasTransactions: true,
    });
  });
});
