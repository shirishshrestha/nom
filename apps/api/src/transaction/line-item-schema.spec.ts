import type { DocumentMetadata } from '@nom/shared';
import { ATTRIBUTE_SETS } from '../attribute-set';
import {
  buildLineItemSchema,
  buildLineItemSystemPrompt,
} from './schemas/line-item-schema';

const emptyMeta: DocumentMetadata = { isFinancial: false, attributeSet: null };

// buildLineItemSchema generates the LLM output contract from an attribute set.
// These guard the shape independently of the (human-authored) prompt rules.
describe('buildLineItemSchema', () => {
  const invoice = ATTRIBUTE_SETS.invoice;
  const schema = buildLineItemSchema(invoice);

  it('parses a well-formed invoice line item', () => {
    const parsed = schema.parse({
      lineItems: [
        {
          description: 'Truck 1x40 FCL Container',
          foundAt: 'line 1',
          sourceText:
            '1 Truck 1x40 FCL Container 1.00 TRIP $220.000 (T) $220.00',
          attributes: {
            quantity: 1,
            unit_price: 220,
            amount: 220,
            currency: 'SGD',
            tax: 'T',
            remarks: null,
          },
          matchBasis: 'local haulage of a 40ft container → local_haulage:40ft',
          initialKind: 'service_match',
          initialCanonical: 'local_haulage',
          initialTierSlug: '40ft',
          initialRefSummary: null,
          taxable: true,
          formula: 'rate * quantity',
          symbols: [
            { name: 'rate', value: null },
            { name: 'quantity', value: 1 },
          ],
        },
      ],
      sectionContext: null,
    });
    expect(parsed.lineItems[0].attributes.amount).toBe(220);
    expect(parsed.lineItems[0].initialKind).toBe('service_match');
  });

  it('parses a sibling-reference line item', () => {
    const parsed = schema.parse({
      lineItems: [
        {
          description: 'Admin Charge 5% of PSA & Depot',
          foundAt: '11',
          sourceText:
            '11 Admin Charge 5% of PSA & Depot 0.05 UNIT $133.000 (T)',
          attributes: {
            quantity: 0.05,
            unit_price: 133,
            amount: 6.65,
            currency: 'SGD',
            tax: 'T',
            remarks: null,
          },
          matchBasis: 'admin fee computed from PSA + Depot lines → sibling_ref',
          initialKind: 'sibling_ref',
          initialCanonical: null,
          initialTierSlug: null,
          initialRefSummary: "PSA 40' LOLO and Depot Handling Charge (JTC)",
          taxable: true,
          formula: 'base * pct',
          symbols: [
            { name: 'base', value: 133 },
            { name: 'pct', value: 0.05 },
          ],
        },
      ],
      sectionContext: null,
    });
    expect(parsed.lineItems[0].initialKind).toBe('sibling_ref');
    expect(parsed.lineItems[0].initialRefSummary).toContain('PSA');
  });

  it('exposes the transient matchBasis scratch field before initialKind', () => {
    const item = schema.shape.lineItems.element.shape;
    expect(item.matchBasis).toBeDefined();
    const keys = Object.keys(item);
    expect(keys.indexOf('matchBasis')).toBeLessThan(
      keys.indexOf('initialKind'),
    );
  });

  it('accepts an empty line-item list', () => {
    expect(
      schema.parse({ lineItems: [], sectionContext: null }).lineItems,
    ).toHaveLength(0);
  });

  it('rejects a line item missing a required attribute (amount)', () => {
    expect(() =>
      schema.parse({
        lineItems: [
          {
            description: 'x',
            foundAt: null,
            sourceText: 'x',
            attributes: { currency: 'SGD' },
          },
        ],
      }),
    ).toThrow();
  });
});

// buildLineItemSystemPrompt composes the neutral shared rules with the per-vertical
// lineItemGuidance block and the runtime vendor-rules override.
describe('buildLineItemSystemPrompt', () => {
  const invoice = ATTRIBUTE_SETS.invoice;
  // A vertical with no lineItemGuidance — exposes the shared rules in isolation.
  const neutral = { ...invoice, lineItemGuidance: undefined };

  it('warns the extractor that a near-acronym is a different service (no surface-collision guess)', () => {
    const prompt = buildLineItemSystemPrompt({
      set: neutral,
      registry: [],
      tiers: [],
      metadata: emptyMeta,
    });
    expect(prompt).toContain(
      'an acronym matches a canonical only when the token is IDENTICAL',
    );
  });

  it('captures section context verbatim, not condensed/truncated (schema field rule)', () => {
    const schema = buildLineItemSchema(neutral);
    const desc = schema.shape.sectionContext.description ?? '';
    expect(desc).toContain(
      'VERBATIM — do not condense, summarise, or truncate',
    );
  });

  it('keeps the shared rules domain-neutral — the moved surface examples are gone', () => {
    const prompt = buildLineItemSystemPrompt({
      set: neutral,
      registry: [],
      tiers: [],
      metadata: emptyMeta,
    });
    // No vertical block for a set that carries no lineItemGuidance.
    expect(prompt).not.toContain('Line-item rules for this document type:');
    // The freight/insurance examples that used to be hardcoded in the shared rules
    // now live in each set's lineItemGuidance, not the neutral base prompt.
    expect(prompt).not.toContain('PSA & Depot');
    expect(prompt).not.toContain('sum_insured * rate / 100');
    expect(prompt).not.toContain('* (1 + gst)');
  });

  it('appends the vertical lineItemGuidance block for a set that carries it', () => {
    const prompt = buildLineItemSystemPrompt({
      set: invoice,
      registry: [],
      tiers: [],
      metadata: emptyMeta,
    });
    expect(prompt).toContain('Line-item rules for this document type:');
    expect(prompt).toContain('GST');
  });

  it('renders the document-context block only when metadata is present', () => {
    const bare = buildLineItemSystemPrompt({
      set: invoice,
      registry: [],
      tiers: [],
      metadata: emptyMeta,
    });
    expect(bare).not.toContain('Document context');

    const withMeta = buildLineItemSystemPrompt({
      set: invoice,
      registry: [],
      tiers: [],
      metadata: { ...emptyMeta, summary: 'March freight billing' },
    });
    expect(withMeta).toContain('Document context');
    expect(withMeta).toContain('Overview: March freight billing');
  });

  it('renders the registry naming hint only when the registry is non-empty', () => {
    const withRegistry = buildLineItemSystemPrompt({
      set: invoice,
      registry: [{ canonicalName: 'local_haulage', description: null }],
      tiers: [],
      metadata: emptyMeta,
    });
    expect(withRegistry).toContain('How to read the registry names');

    const empty = buildLineItemSystemPrompt({
      set: invoice,
      registry: [],
      tiers: [],
      metadata: emptyMeta,
    });
    expect(empty).not.toContain('How to read the registry names');
  });

  it('appends the vendor-rules override last', () => {
    const prompt = buildLineItemSystemPrompt({
      set: invoice,
      registry: [],
      tiers: [],
      metadata: emptyMeta,
      rules: 'Treat handling fees as unmatched.',
    });
    expect(prompt).toContain('Vendor rules');
    expect(prompt).toContain('Treat handling fees as unmatched.');
  });
});
