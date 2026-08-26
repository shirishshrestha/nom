import { validateExpression } from './validate-expression';

describe('validateExpression', () => {
  it('accepts a well-formed expression over declared symbols', () => {
    expect(validateExpression('rate * quantity', ['rate', 'quantity'])).toEqual(
      {
        ok: true,
        issues: [],
      },
    );
  });

  it('accepts a flat single-symbol formula', () => {
    expect(validateExpression('rate', ['rate'])).toEqual({
      ok: true,
      issues: [],
    });
  });

  it('accepts parenthesised tax-inclusive form', () => {
    const r = validateExpression('rate * quantity * (1 + gst)', [
      'rate',
      'quantity',
      'gst',
    ]);
    expect(r.ok).toBe(true);
  });

  it('flags an undeclared symbol', () => {
    const r = validateExpression('rate * qty', ['rate']);
    expect(r.ok).toBe(false);
    expect(r.issues).toContain('unknown symbol "qty"');
  });

  it('flags unbalanced parentheses', () => {
    const r = validateExpression('(rate * quantity', ['rate', 'quantity']);
    expect(r.ok).toBe(false);
    expect(r.issues).toContain('unbalanced parentheses');
  });

  it('flags a trailing operator', () => {
    const r = validateExpression('rate *', ['rate']);
    expect(r.ok).toBe(false);
    expect(r.issues).toContain('malformed expression');
  });

  it('flags an empty formula', () => {
    expect(validateExpression('  ', [])).toEqual({
      ok: false,
      issues: ['empty formula'],
    });
  });

  it('flags an illegal character', () => {
    const r = validateExpression('rate % quantity', ['rate', 'quantity']);
    expect(r.ok).toBe(false);
    expect(r.issues).toContain('illegal token "%"');
  });
});
