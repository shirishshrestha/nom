import { ATTRIBUTE_SETS, resolveBilledAmount } from './attribute-set.registry';

describe('resolveBilledAmount', () => {
  it('picks the invoice `amount` field', () => {
    expect(
      resolveBilledAmount(ATTRIBUTE_SETS.invoice, {
        quantity: 2,
        unit_price: 110,
        amount: 220,
      }),
    ).toBe(220);
  });

  it('falls back to `premium` for an endorsement when `amount` is null', () => {
    expect(
      resolveBilledAmount(ATTRIBUTE_SETS.endorsement, {
        amount: null,
        premium: 350,
      }),
    ).toBe(350);
  });

  it('prefers `amount` over `premium` when both present (endorsement order)', () => {
    expect(
      resolveBilledAmount(ATTRIBUTE_SETS.endorsement, {
        amount: 400,
        premium: 350,
      }),
    ).toBe(400);
  });

  it('returns null when no candidate key holds a finite number', () => {
    expect(
      resolveBilledAmount(ATTRIBUTE_SETS.invoice, {
        quantity: 2,
        unit_price: 110,
        amount: null,
      }),
    ).toBeNull();
  });
});
