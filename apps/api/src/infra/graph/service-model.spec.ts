import { deriveServiceModel } from './service-model';

const line = (tier: string | null, pricingContext = '') => ({
  tier,
  pricingContext,
});

describe('deriveServiceModel', () => {
  it('classifies a group with any tier as Tiered', () => {
    expect(
      deriveServiceModel([
        line(null, 'per box'),
        line('20ft', 'per container'),
      ]),
    ).toBe('Tiered');
  });

  it('returns Flat for any non-tiered group', () => {
    // Free allowance / % of value derivation is commented out for now, so these
    // all fall through to Flat regardless of pricing wording.
    expect(deriveServiceModel([line(null, 'S$180.00 per tug/hour')])).toBe(
      'Flat',
    );
    expect(deriveServiceModel([line(null, '0.5% of CIF value')])).toBe('Flat');
    expect(
      deriveServiceModel([line(null, 'first 3 days free of charge')]),
    ).toBe('Flat');
  });
});
