import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { DocumentEntity, VendorEntity } from '@nom/database';
import { DOCUMENT_STATUSES, DOCUMENT_TYPES } from '@nom/shared';
import type { DashboardDto } from '@nom/dtos';
import type { OrgSession } from '../auth/auth.types.js';
import { LineItemGraphRepository } from '../infra/graph/line-item-graph.repository';

// Live dashboard aggregation: the four KPI cards from a single per-tenant line-item
// rollup (Neo4j), plus cheap upload-card status counts (Postgres). No precompute —
// at this load the graph scan is low tens of ms (see plan).
@Injectable()
export class DashboardService {
  constructor(
    private readonly lineItemGraph: LineItemGraphRepository,
    @InjectRepository(DocumentEntity)
    private readonly documentsRepo: Repository<DocumentEntity>,
    @InjectRepository(VendorEntity)
    private readonly vendorsRepo: Repository<VendorEntity>,
  ) {}

  async getDashboard(session: OrgSession): Promise<DashboardDto> {
    const organizationId = session.session.activeOrganizationId;

    const day = 86_400_000;
    const now = Date.now();
    const since = new Date(now - 30 * day).toISOString();
    const priorSince = new Date(now - 60 * day).toISOString();

    const [stats, vendorCount, quotationCount, transactionCount] =
      await Promise.all([
        this.lineItemGraph.getTenantStats(organizationId, since, priorSince),
        this.vendorsRepo.count({ where: { organizationId } }),
        this.documentsRepo.count({
          where: {
            organizationId,
            documentType: DOCUMENT_TYPES.SOURCE,
            status: Not(DOCUMENT_STATUSES.REJECTED),
          },
        }),
        this.documentsRepo.count({
          where: {
            organizationId,
            documentType: DOCUMENT_TYPES.TRANSACTION,
            status: Not(DOCUMENT_STATUSES.REJECTED),
          },
        }),
      ]);

    const cur = stats.current;
    const prior = stats.prior;

    const flags = cur.mismatchCount + cur.needsReviewCount;
    const priorFlags = prior.mismatchCount + prior.needsReviewCount;
    // Guard divide-by-zero: a window with no adjudicated lines / no documents reads 0.
    const percent = accuracy(cur);
    const avgFlags =
      cur.documentCount > 0 ? round2(flags / cur.documentCount) : 0;

    return {
      overcharges: {
        amount: round2(cur.overchargeSum),
        trendPercent: trend(cur.overchargeSum, prior.overchargeSum),
        previousAmount: round2(prior.overchargeSum),
      },
      verification: {
        percent,
        trendPercent: trend(percent, accuracy(prior)),
        lineItemsVerified: cur.matchCount,
        totalLineItems: cur.adjudicated,
        invoiceCount: cur.documentCount,
      },
      exceptions: { count: flags, trendPercent: trend(flags, priorFlags) },
      averageFlagsPerFile: {
        value: avgFlags,
        trendPercent: trend(
          avgFlags,
          prior.documentCount > 0 ? priorFlags / prior.documentCount : 0,
        ),
      },
      status: {
        hasVendors: vendorCount > 0,
        hasQuotations: quotationCount > 0,
        hasTransactions: transactionCount > 0,
      },
      meta: { lastUpdated: new Date().toISOString(), period: 'last-30-days' },
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function accuracy(w: { matchCount: number; adjudicated: number }): number {
  return w.adjudicated > 0 ? round2((w.matchCount / w.adjudicated) * 100) : 0;
}

// Relative % change vs the prior window; null when the baseline is 0 (no chip shown).
function trend(cur: number, prior: number): number | null {
  return prior > 0 ? round2(((cur - prior) / prior) * 100) : null;
}
