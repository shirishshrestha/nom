import { ATTRIBUTE_SETS } from '../attribute-set';
import {
  buildServiceSchema,
  buildServiceSystemPrompt,
  buildCanonicalMatchPrompt,
  buildCanonicalMatchSchema,
} from './service-schema';

describe('service-schema', () => {
  const set = ATTRIBUTE_SETS.quotation;
  const META = { isFinancial: false, attributeSet: null };

  it('builds a schema that parses a sample line item with the dynamic attribute bag', () => {
    const schema = buildServiceSchema(set);
    const parsed = schema.parse({
      services: [
        {
          title: 'Customs clearance (FCL)',
          nameBasis: 'concept=customs clearance; axis=TEU band; grain=0_10_teu',
          canonicalName: 'customs clearance',
          canonicalDescription: 'Clearing cargo through customs.',
          category: 'customs',
          tier: '0-10 TEU',
          tierSlug: '0_10_teu',
          pricingContext: 'per container, FCL only',
          foundAt: 'origin charges table, page 1',
          sourceText: 'Customs clearance (FCL) — S$140 per container',
          attributes: {
            price: 140,
            currency: 'SGD',
            unit: 'per container',
            remarks: null,
          },
        },
      ],
      sectionContext: null,
    });
    expect(parsed.services).toHaveLength(1);
    expect(parsed.services[0].attributes.price).toBe(140);
  });

  it('canonical-match tells insurance lines to reuse an existing cover (amendment), but not freight', () => {
    const insurance = buildCanonicalMatchPrompt(
      ATTRIBUTE_SETS.insurance,
      [],
      [],
    );
    const freight = buildCanonicalMatchPrompt(ATTRIBUTE_SETS.quotation, [], []);
    expect(insurance).toContain('breaks the amendment chain');
    expect(freight).not.toContain('breaks the amendment chain');
  });

  it('both schemas expose the transient nameBasis scratch field before canonicalName', () => {
    const item = buildServiceSchema(set).shape.services.element.shape;
    expect(item.nameBasis).toBeDefined();
    const itemKeys = Object.keys(item);
    expect(itemKeys.indexOf('nameBasis')).toBeLessThan(
      itemKeys.indexOf('canonicalName'),
    );

    const assignment =
      buildCanonicalMatchSchema().shape.assignments.element.shape;
    expect(assignment.nameBasis).toBeDefined();
    const assignKeys = Object.keys(assignment);
    expect(assignKeys.indexOf('nameBasis')).toBeLessThan(
      assignKeys.indexOf('canonicalName'),
    );
  });

  it('both prompts carry BOTH naming sub-recipes (adjudicator parity — the slug recipe cannot regress to extract-only)', () => {
    const extract = buildServiceSystemPrompt(
      ATTRIBUTE_SETS.quotation,
      [],
      [],
      META,
    );
    const match = buildCanonicalMatchPrompt(ATTRIBUTE_SETS.quotation, [], []);
    for (const prompt of [extract, match]) {
      // concept recipe
      expect(prompt).toContain('name what the service fundamentally IS');
      // tierSlug grain recipe
      expect(prompt).toContain('COARSEST grain');
      expect(prompt).toContain('nameBasis');
    }
  });

  it('both prompts open the naming procedure with an observation step (read all context before naming)', () => {
    const extract = buildServiceSystemPrompt(
      ATTRIBUTE_SETS.quotation,
      [],
      [],
      META,
    );
    const match = buildCanonicalMatchPrompt(ATTRIBUTE_SETS.quotation, [], []);
    for (const prompt of [extract, match]) {
      expect(prompt).toContain('OBSERVE');
      expect(prompt).toContain('Never name from the title alone');
    }
  });

  it('canonical-match shared skeleton carries no domain vocabulary (all verticals injected)', () => {
    const neutral = {
      key: 'neutral',
      documentType: 'source' as const,
      label: 'Neutral',
      description: '',
      promptContext: 'You are a data extractor.',
      attributes: [],
      amountKeys: [],
    };
    const prompt = buildCanonicalMatchPrompt(neutral, [], []);
    expect(prompt).not.toContain('local_haulage');
    expect(prompt).not.toContain('commodity');
    expect(prompt).not.toContain('SKU');
    // the brevity rule survives in the neutral skeleton
    expect(prompt).toContain('2 to 4 tokens');
  });

  it("canonical-match injects the set's namingGuidance (freight examples live in the set, not the shared text)", () => {
    const freight = buildCanonicalMatchPrompt(ATTRIBUTE_SETS.quotation, [], []);
    const insurance = buildCanonicalMatchPrompt(
      ATTRIBUTE_SETS.insurance,
      [],
      [],
    );
    expect(freight).toContain('local_haulage_20ft');
    expect(insurance).not.toContain('local_haulage_20ft');
    // stage lives on the tier axis, never in the canonical name
    expect(insurance).toContain('main_voyage_foodstuffs');
    expect(insurance).not.toContain('all_risks_main_voyage');
  });

  it('canonical-match appends vendor rules as an override block; undefined is byte-identical', () => {
    const base = buildCanonicalMatchPrompt(ATTRIBUTE_SETS.quotation, [], []);
    const withUndefined = buildCanonicalMatchPrompt(
      ATTRIBUTE_SETS.quotation,
      [],
      [],
      undefined,
    );
    const withRules = buildCanonicalMatchPrompt(
      ATTRIBUTE_SETS.quotation,
      [],
      [],
      'Always split multi-leg haulage.',
    );
    expect(withUndefined).toBe(base);
    expect(withRules).toContain('Always split multi-leg haulage.');
    expect(withRules).toContain('Vendor rules');
  });

  it('canonical-match prompt uses contracted price/unit as a reuse tie-breaker across sections', () => {
    const prompt = buildCanonicalMatchPrompt(ATTRIBUTE_SETS.quotation, [], []);
    expect(prompt).toContain(
      'a section banner alone — e.g. one department vs another — never justifies a near-duplicate name for the same fee',
    );
    expect(prompt).toContain(
      'price/unit-basis conflict is real evidence the concepts differ',
    );
  });

  it('prompt lists every attribute key, the running canonical registry, and known tier slugs', () => {
    const prompt = buildServiceSystemPrompt(
      set,
      [{ canonicalName: 'customs clearance', description: 'existing concept' }],
      [
        {
          canonicalName: 'customs clearance',
          tierSlug: '0_10_teu',
          label: '0-10 TEU',
          pricingContext: null,
          attributes: null,
        },
      ],
      META,
    );
    for (const a of set.attributes) expect(prompt).toContain(`"${a.key}"`);
    expect(prompt).toContain('customs clearance');
    expect(prompt).toContain('0_10_teu');
  });

  it('extract prompt does NOT leak an existing service price (no anchoring of newly-minted rates)', () => {
    const prompt = buildServiceSystemPrompt(
      set,
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
          attributes: { price: 0.6, unit: 'per D/O' },
        },
      ],
      META,
    );
    expect(prompt).toContain('documentation_processing_fee');
    expect(prompt).not.toContain('price=0.6');
  });

  it('prompt notes an empty registry on the first run', () => {
    const prompt = buildServiceSystemPrompt(set, [], [], META);
    expect(prompt).toContain('none yet');
  });
});
