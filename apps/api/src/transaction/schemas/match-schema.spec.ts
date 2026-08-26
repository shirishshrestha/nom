import type { DocumentMetadata } from '@nom/shared';
import { ATTRIBUTE_SETS } from '../../attribute-set';
import { buildMatchSchema, buildMatchSystemPrompt } from './match-schema';

const meta: DocumentMetadata = { isFinancial: false, attributeSet: null };

// Guards the match-prompt wiring: the tier pricingContext render, which surfaces
// each canonical's contracted rate / conditions to the adjudicator.

describe('buildMatchSystemPrompt', () => {
  it("renders a canonical's tier pricingContext into the prompt", () => {
    const prompt = buildMatchSystemPrompt({
      set: ATTRIBUTE_SETS.endorsement,
      registry: [
        {
          canonicalName: 'spices_nuts_dried_fruits_premium_rate',
          description:
            'Premium insurance rate for spices/nuts/coffee shipments.',
        },
      ],
      tiers: [
        {
          canonicalName: 'spices_nuts_dried_fruits_premium_rate',
          tierSlug: 'containerized_transshipments',
          label: 'Containerized Transshipments (FCL/LCL)',
          pricingContext: 'Rate is 0.04000% of shipment value.',
          attributes: null,
        },
      ],
      metadata: meta,
    });
    expect(prompt).toContain('Rate is 0.04000% of shipment value.');
  });

  it('renders the document-context block only when metadata is present', () => {
    const base = {
      set: ATTRIBUTE_SETS.endorsement,
      registry: [],
      tiers: [],
    };
    expect(buildMatchSystemPrompt({ ...base, metadata: meta })).not.toContain(
      'Document context',
    );

    const withMeta = buildMatchSystemPrompt({
      ...base,
      metadata: { ...meta, summary: 'March marine cargo endorsement' },
    });
    expect(withMeta).toContain('Document context');
    expect(withMeta).toContain('Overview: March marine cargo endorsement');
  });

  it('renders the registry naming hint only when the registry is non-empty', () => {
    const base = { set: ATTRIBUTE_SETS.endorsement, tiers: [], metadata: meta };
    const withRegistry = buildMatchSystemPrompt({
      ...base,
      registry: [{ canonicalName: 'all_risks', description: null }],
    });
    expect(withRegistry).toContain('How to read the registry names');

    expect(buildMatchSystemPrompt({ ...base, registry: [] })).not.toContain(
      'How to read the registry names',
    );
  });

  it('emits the per-field reasoning before the decision fields', () => {
    const keys = Object.keys(buildMatchSchema().shape.matches.element.shape);
    expect(keys.indexOf('reasoning')).toBeLessThan(keys.indexOf('kind'));
  });

  it('tells the adjudicator a taxable line is not automatically tax-inclusive (jurisdiction-neutral)', () => {
    const prompt = buildMatchSystemPrompt({
      set: ATTRIBUTE_SETS.endorsement,
      registry: [],
      tiers: [],
      metadata: meta,
    });
    // default is no tax factor — guards against adding one to a tax-exclusive line
    expect(prompt).toContain('ALWAYS DEFAULT to no tax factor');
    expect(prompt).toContain(
      'unless a reviewerGuidance or vendor rule explicitly instructs you to include tax',
    );
    // no jurisdiction-specific tax vocabulary leaks into the rule
    expect(prompt).not.toContain('9% GST');
    expect(prompt).not.toContain('(T)');
  });

  it('tells the adjudicator to confine a self-scoped vendor rule to the lines it names (no bleed)', () => {
    const prompt = buildMatchSystemPrompt({
      set: ATTRIBUTE_SETS.endorsement,
      registry: [],
      tiers: [],
      metadata: meta,
    });
    expect(prompt).toContain('governs ONLY the lines meeting that scope');
    // generic — carries no vertical/vendor vocabulary
    expect(prompt).not.toContain('TMP');
  });

  it('tells the adjudicator not to accept an acronym/surface-resemblance guess', () => {
    const prompt = buildMatchSystemPrompt({
      set: ATTRIBUTE_SETS.endorsement,
      registry: [],
      tiers: [],
      metadata: meta,
    });
    expect(prompt).toContain(
      'An acronym matches only when the token is IDENTICAL',
    );
    expect(prompt).toContain(
      'substring/superstring acronym (CDMS vs CMS), is a DIFFERENT service',
    );
  });

  it('tells the adjudicator to leave a grossly rate-inconsistent name-only match unmatched', () => {
    const prompt = buildMatchSystemPrompt({
      set: ATTRIBUTE_SETS.endorsement,
      registry: [],
      tiers: [],
      metadata: meta,
    });
    expect(prompt).toContain('classify "unmatched" rather than force-fit');
    // ...but a modest delta stays a match (overcharge finding, not a rejection)
    expect(prompt).toContain('a MODEST difference is NOT grounds to reject');
  });

  it('tells the adjudicator not to compute or verify a derived-price service at match time', () => {
    const prompt = buildMatchSystemPrompt({
      set: ATTRIBUTE_SETS.endorsement,
      registry: [],
      tiers: [],
      metadata: meta,
    });
    expect(prompt).toContain('has no rate visible here');
  });

  it('tells the adjudicator an in-scope vendor rule is authoritative, not amount-verified', () => {
    const prompt = buildMatchSystemPrompt({
      set: ATTRIBUTE_SETS.endorsement,
      registry: [],
      tiers: [],
      metadata: meta,
    });
    expect(prompt).toContain('judge whether the rule is "warranted"');
  });

  it('appends the vendor-rules block only when rules are supplied', () => {
    const base = {
      set: ATTRIBUTE_SETS.endorsement,
      registry: [],
      tiers: [],
      metadata: meta,
    };
    expect(buildMatchSystemPrompt(base)).not.toContain('Vendor rules');

    const withRules = buildMatchSystemPrompt({
      ...base,
      rules: 'Prefer reusing the take-over cover.',
    });
    expect(withRules).toContain('Vendor rules');
    expect(withRules).toContain('Prefer reusing the take-over cover.');
  });
});
