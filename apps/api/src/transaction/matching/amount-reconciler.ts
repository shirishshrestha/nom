import { Injectable, Logger } from '@nestjs/common';
import { LINE_ITEM_STATUSES, type LineItemStatus } from '@nom/shared';
import { type AttributeSet, resolveBilledAmount } from '../../attribute-set';
import { evaluateExpression } from '../expression/evaluate-expression';
import { logEntry } from '../audit-log';

/** A matched line ready to reconcile: its formula + resolved symbols vs the billed total. */
export interface ReconcilableLine {
  id: string;
  formula: string | null;
  symbols: Record<string, number | null> | null;
  attributes: Record<string, string | number | null>;
}

/** The reconciler's per-line verdict and the log lines to append. */
export interface ReconciledRow {
  id: string;
  status: LineItemStatus;
  expectedAmount: number | null; // formula evaluation result (calculated total)
  billedAmount: number | null; // billed amount from the attribute bag
  reviewNote: string | null; // needs_review only: what context is missing
  logAdditions: string[];
}

// Match if |expected − billed| ≤ max(1¢, 0.5% of billed); a zero-billed line only
// matches when expected rounds to $0.00 (an absolute cent tolerance would call
// $0.01-vs-$0.00 — a 100% discrepancy — a match).
// ponytail: single policy for all vendors; make per-vendor if business rules diverge
const TOLERANCE_FLOOR = 0.01;
const TOLERANCE_RELATIVE = 0.005;

/** The reconciliation verdict phrased for the audit trail; a null side reads "unknown". */
function reconcileLogLine(
  status: LineItemStatus,
  expected: number | null,
  billed: number | null,
): string {
  const e = expected ?? 'unknown';
  const b = billed ?? 'unknown';
  if (status === LINE_ITEM_STATUSES.MATCH)
    return `Amounts reconcile: expected ${e}, billed ${b} — match.`;
  if (status === LINE_ITEM_STATUSES.MISMATCH)
    return `Amounts do not reconcile: expected ${e}, billed ${b} — mismatch.`;
  return `Could not verify the amount (expected ${e}, billed ${b}) — needs review.`;
}

/**
 * Phase 4 — evaluate each matched line's formula over its resolved symbols to the expected
 * amount, compare against the billed amount, and record a review verdict (`LineItem.status`).
 * Pure/deterministic: matching links the line to its service, resolution fills the arithmetic,
 * and this closes the loop by checking the money. An uncomputable side stays `needs_review`.
 */
@Injectable()
export class AmountReconciler {
  private readonly logger = new Logger(AmountReconciler.name);

  reconcile(set: AttributeSet, lines: ReconcilableLine[]): ReconciledRow[] {
    this.logger.debug(
      `reconciling amounts for ${lines.length} matched line(s)`,
    );
    return lines.map((l) => this.reconcileLine(set, l));
  }

  private reconcileLine(
    set: AttributeSet,
    line: ReconcilableLine,
  ): ReconciledRow {
    const expected = evaluateExpression(line.formula, line.symbols ?? {});
    const billed = resolveBilledAmount(set, line.attributes);

    let status: LineItemStatus;
    if (expected === null || billed === null) {
      status = LINE_ITEM_STATUSES.NEEDS_REVIEW;
    } else if (this.withinTolerance(expected, billed)) {
      status = LINE_ITEM_STATUSES.MATCH;
    } else {
      status = LINE_ITEM_STATUSES.MISMATCH;
    }

    return {
      id: line.id,
      status,
      expectedAmount: expected,
      billedAmount: billed,
      reviewNote:
        status === LINE_ITEM_STATUSES.NEEDS_REVIEW
          ? this.reviewNote(line, expected, billed)
          : null,
      logAdditions: [logEntry(reconcileLogLine(status, expected, billed))],
    };
  }

  /** Relative tolerance with a 1-cent floor; billed=0 must compute to sub-cent zero. */
  private withinTolerance(expected: number, billed: number): boolean {
    if (billed === 0) return Math.abs(expected) < 0.005;
    return (
      Math.abs(expected - billed) <=
      Math.max(TOLERANCE_FLOOR, TOLERANCE_RELATIVE * Math.abs(billed))
    );
  }

  /** Plain statement of the missing context — the user supplies it and the flow reruns. */
  private reviewNote(
    line: ReconcilableLine,
    expected: number | null,
    billed: number | null,
  ): string {
    if (expected === null) {
      if (line.formula === null) return 'Needs context: no formula';
      const unresolved = Object.entries(line.symbols ?? {})
        .filter(([, v]) => v === null)
        .map(([name]) => name);
      return unresolved.length > 0
        ? `Needs context: unresolved symbol(s) ${unresolved.join(', ')}`
        : 'Needs context: expected amount could not be computed';
    }
    if (billed === null) return 'Needs context: billed amount missing';
    return 'Needs context';
  }
}
