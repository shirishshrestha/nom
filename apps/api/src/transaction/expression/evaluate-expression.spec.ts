import { evaluateExpression } from './evaluate-expression';

describe('evaluateExpression', () => {
  it('evaluates a product of symbols', () => {
    expect(
      evaluateExpression('rate * quantity', { rate: 100, quantity: 3 }),
    ).toBe(300);
  });

  it('returns a flat single-symbol value', () => {
    expect(evaluateExpression('rate', { rate: 42.5 })).toBe(42.5);
  });

  it('honours operator precedence', () => {
    expect(evaluateExpression('a + b * c', { a: 1, b: 2, c: 3 })).toBe(7);
  });

  it('honours parentheses (tax-inclusive form)', () => {
    expect(
      evaluateExpression('rate * quantity * (1 + gst)', {
        rate: 100,
        quantity: 2,
        gst: 0.09,
      }),
    ).toBeCloseTo(218);
  });

  it('applies a percentage rate via /100 (insurance premium)', () => {
    // sum_insured * rate / 100 == (sum_insured * rate) / 100 — rate is the percentage number.
    expect(
      evaluateExpression('sum_insured * rate / 100', {
        sum_insured: 180455,
        rate: 0.05,
      }),
    ).toBeCloseTo(90.2275);
  });

  it('returns null when a required symbol is still null', () => {
    expect(
      evaluateExpression('rate * quantity', { rate: null, quantity: 3 }),
    ).toBeNull();
  });

  it('returns null for a symbol missing from the map', () => {
    expect(evaluateExpression('rate * qty', { rate: 100 })).toBeNull();
  });

  it('returns null on divide-by-zero', () => {
    expect(
      evaluateExpression('rate / quantity', { rate: 100, quantity: 0 }),
    ).toBeNull();
  });

  it('returns null for a null formula', () => {
    expect(evaluateExpression(null, { rate: 100 })).toBeNull();
  });

  it('returns null for an empty formula', () => {
    expect(evaluateExpression('   ', {})).toBeNull();
  });

  it('returns null on unbalanced parentheses', () => {
    expect(
      evaluateExpression('(rate * quantity', { rate: 1, quantity: 2 }),
    ).toBeNull();
  });

  it('returns null on an illegal token', () => {
    expect(
      evaluateExpression('rate % quantity', { rate: 1, quantity: 2 }),
    ).toBeNull();
  });
});
