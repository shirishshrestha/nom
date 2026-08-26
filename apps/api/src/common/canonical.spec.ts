import { normalizeCanonical } from './canonical';

describe('normalizeCanonical', () => {
  it('lowercases, trims, and collapses non-alphanumeric runs to underscores', () => {
    expect(normalizeCanonical('Customs Clearance')).toBe('customs_clearance');
    expect(normalizeCanonical('customs-clearance')).toBe('customs_clearance');
    expect(normalizeCanonical('  customs  clearance  ')).toBe(
      'customs_clearance',
    );
  });

  it('strips leading/trailing underscores left by punctuation at the edges', () => {
    expect(normalizeCanonical('--Customs Clearance!!')).toBe(
      'customs_clearance',
    );
  });
});
