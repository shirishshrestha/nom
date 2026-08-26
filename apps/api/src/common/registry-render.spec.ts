import { renderRegistry } from './registry-render';

describe('renderRegistry', () => {
  it('renders bare canonicals with no tiers unchanged', () => {
    const out = renderRegistry(
      [{ canonicalName: 'local_haulage', description: 'Trucking.' }],
      [],
      '(none)',
    );
    expect(out).toBe('- local_haulage — Trucking.');
  });

  it('returns the empty message when there are no canonicals', () => {
    expect(renderRegistry([], [], '(no services yet)')).toBe(
      '(no services yet)',
    );
  });

  it('renders a tier with only a label the same as before (no regression)', () => {
    const out = renderRegistry(
      [{ canonicalName: 'local_haulage', description: 'Trucking.' }],
      [
        {
          canonicalName: 'local_haulage',
          tierSlug: '20ft',
          label: '20ft',
          pricingContext: null,
          attributes: null,
        },
      ],
      '(none)',
    );
    expect(out).toBe('- local_haulage — Trucking. | tiers: 20ft (20ft)');
  });

  it('renders a bare tierSlug when neither label nor pricingContext is present', () => {
    const out = renderRegistry(
      [{ canonicalName: 'local_haulage', description: null }],
      [
        {
          canonicalName: 'local_haulage',
          tierSlug: '20ft',
          label: null,
          pricingContext: null,
          attributes: null,
        },
      ],
      '(none)',
    );
    expect(out).toBe('- local_haulage | tiers: 20ft');
  });

  it('appends pricingContext inline when present — the disambiguating text a bare name/description can lack', () => {
    const out = renderRegistry(
      [
        {
          canonicalName: 'empty_cartons_shipment_insurance',
          description:
            'Ordinary risks insurance for shipments of empty cartons.',
        },
      ],
      [
        {
          canonicalName: 'empty_cartons_shipment_insurance',
          tierSlug: 'empty_cartons',
          label: 'Empty Cartons',
          pricingContext:
            'Ordinary risks including War (Waterborne) and SRCC risks. Rate is 0.05% of shipment value.',
          attributes: null,
        },
      ],
      '(none)',
    );
    expect(out).toBe(
      '- empty_cartons_shipment_insurance — Ordinary risks insurance for shipments of empty cartons. | ' +
        'tiers: empty_cartons (Empty Cartons: Ordinary risks including War (Waterborne) and SRCC risks. Rate is 0.05% of shipment value.)',
    );
  });

  it('truncates an over-long pricingContext with an ellipsis; a short one is verbatim', () => {
    const long = 'x'.repeat(600);
    const out = renderRegistry(
      [{ canonicalName: 'c', description: null }],
      [
        {
          canonicalName: 'c',
          tierSlug: 's',
          label: null,
          pricingContext: long,
          attributes: null,
        },
      ],
      '(none)',
    );
    // 500 chars kept + ellipsis
    expect(out).toBe(`- c | tiers: s (${'x'.repeat(500)}…)`);

    const short = 'per container';
    const shortOut = renderRegistry(
      [{ canonicalName: 'c', description: null }],
      [
        {
          canonicalName: 'c',
          tierSlug: 's',
          label: null,
          pricingContext: short,
          attributes: null,
        },
      ],
      '(none)',
    );
    expect(shortOut).toBe('- c | tiers: s (per container)');
  });

  it('renders a flat (null-slug) service as "flat" with its priced attributes so it can be disambiguated by rate', () => {
    const out = renderRegistry(
      [
        {
          canonicalName: 'documentation_processing_fee',
          description: 'D/O fee.',
        },
      ],
      [
        {
          canonicalName: 'documentation_processing_fee',
          tierSlug: null,
          label: null,
          pricingContext: null,
          attributes: { price: 0.6, currency: 'SGD', unit: 'per D/O' },
        },
      ],
      '(none)',
    );
    expect(out).toBe(
      '- documentation_processing_fee — D/O fee. | tiers: flat (price=0.6, currency=SGD, unit=per D/O)',
    );
  });

  it('renders pricingContext alone in parens when the tier has no label', () => {
    const out = renderRegistry(
      [{ canonicalName: 'flat_rate', description: null }],
      [
        {
          canonicalName: 'flat_rate',
          tierSlug: 'flat',
          label: null,
          pricingContext: 'per container, FCL only',
          attributes: null,
        },
      ],
      '(none)',
    );
    expect(out).toBe('- flat_rate | tiers: flat (per container, FCL only)');
  });
});
