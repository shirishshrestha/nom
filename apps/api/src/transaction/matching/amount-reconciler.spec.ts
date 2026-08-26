import { ATTRIBUTE_SETS } from '../../attribute-set';
import { LINE_ITEM_STATUSES } from '@nom/shared';
import { AmountReconciler, type ReconcilableLine } from './amount-reconciler';

// AmountReconciler evaluates a matched line's formula over its resolved symbols and
// compares the expected amount to the billed amount (invoice set: amountKeys=['amount']).

const set = ATTRIBUTE_SETS.invoice;
const reconciler = new AmountReconciler();

function line(over: Partial<ReconcilableLine> = {}): ReconcilableLine {
  return {
    id: 'a',
    formula: 'rate * quantity',
    symbols: { rate: 100, quantity: 2 },
    attributes: { amount: 200 },
    ...over,
  };
}

describe('AmountReconciler', () => {
  it('marks a line match when expected equals billed', () => {
    const [row] = reconciler.reconcile(set, [line()]);
    expect(row.status).toBe(LINE_ITEM_STATUSES.MATCH);
    expect(row.expectedAmount).toBe(200);
    expect(row.billedAmount).toBe(200);
    expect(row.reviewNote).toBeNull();
    expect(row.logAdditions[0]).toContain(
      'Amounts reconcile: expected 200, billed 200 — match.',
    );
  });

  it('tolerates a sub-cent difference', () => {
    const [row] = reconciler.reconcile(set, [
      line({ attributes: { amount: 200.005 } }),
    ]);
    expect(row.status).toBe(LINE_ITEM_STATUSES.MATCH);
  });

  it('tolerates a within-relative-tolerance difference on large amounts', () => {
    // 0.5% of 200 = 1.00 tolerance
    const [row] = reconciler.reconcile(set, [
      line({ symbols: { rate: 100.5, quantity: 2 } }), // expected 201 vs billed 200
    ]);
    expect(row.status).toBe(LINE_ITEM_STATUSES.MATCH);
  });

  it('marks mismatch when the difference exceeds the relative tolerance', () => {
    const [row] = reconciler.reconcile(set, [
      line({ symbols: { rate: 101.5, quantity: 2 } }), // expected 203 vs billed 200
    ]);
    expect(row.status).toBe(LINE_ITEM_STATUSES.MISMATCH);
  });

  it('marks mismatch when billed is zero but the formula computes a cent', () => {
    const [row] = reconciler.reconcile(set, [
      line({ symbols: { rate: 0.01, quantity: 1 }, attributes: { amount: 0 } }),
    ]);
    expect(row.status).toBe(LINE_ITEM_STATUSES.MISMATCH);
  });

  it('matches a zero-billed line whose expected amount rounds to zero', () => {
    const [row] = reconciler.reconcile(set, [
      line({
        symbols: { rate: 0.004, quantity: 1 },
        attributes: { amount: 0 },
      }),
    ]);
    expect(row.status).toBe(LINE_ITEM_STATUSES.MATCH);
  });

  it('marks a line mismatch when expected differs from billed', () => {
    const [row] = reconciler.reconcile(set, [
      line({ attributes: { amount: 250 } }),
    ]);
    expect(row.status).toBe(LINE_ITEM_STATUSES.MISMATCH);
    expect(row.expectedAmount).toBe(200);
    expect(row.billedAmount).toBe(250);
    expect(row.reviewNote).toBeNull();
  });

  it('marks needs_review when a symbol is unresolved (expected null)', () => {
    const [row] = reconciler.reconcile(set, [
      line({ symbols: { rate: null, quantity: 2 } }),
    ]);
    expect(row.status).toBe(LINE_ITEM_STATUSES.NEEDS_REVIEW);
    expect(row.expectedAmount).toBeNull();
    expect(row.reviewNote).toBe('Needs context: unresolved symbol(s) rate');
  });

  it('marks needs_review when no billed amount is present', () => {
    const [row] = reconciler.reconcile(set, [line({ attributes: {} })]);
    expect(row.status).toBe(LINE_ITEM_STATUSES.NEEDS_REVIEW);
    expect(row.billedAmount).toBeNull();
    expect(row.reviewNote).toBe('Needs context: billed amount missing');
  });
});
