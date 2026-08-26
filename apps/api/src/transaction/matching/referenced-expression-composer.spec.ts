import { ATTRIBUTE_SETS } from '../../attribute-set';
import { FakeStructuredExtractor } from '../../infra/llm/fake.structured-extractor';
import { evaluateExpression } from '../expression/evaluate-expression';
import {
  ReferencedExpressionComposer,
  type ComposableLine,
} from './referenced-expression-composer';
import type { ComposeResult } from '../schemas/referenced-compose-schema';

// The composer rewrites a referencing line's formula to encode its cross-service pricing
// chain ("B = 40% of A", "A = 1% of total value") and sources the symbols, leaving the
// arithmetic to the deterministic evaluator. Driven with a FakeStructuredExtractor.

const set = ATTRIBUTE_SETS.invoice;

function line(over: Partial<ComposableLine> = {}): ComposableLine {
  return {
    id: 'a',
    description: 'Documentation handling fee',
    canonicalName: 'documentation_handling',
    formula: 'rate * quantity',
    symbols: { rate: null, quantity: 2 },
    attributes: { sum_insured: 1000, quantity: 2 },
    references: [
      {
        fromCanonical: 'documentation_handling',
        referencedCanonical: 'customs_clearance',
        relation: '40% of customs clearance, which is 1% of total value',
        referencedTierSlug: null,
      },
    ],
    ...over,
  };
}

function build(result: ComposeResult) {
  const fake = new FakeStructuredExtractor(() => result);
  return { fake, composer: new ReferencedExpressionComposer(fake) };
}

describe('ReferencedExpressionComposer', () => {
  it('composes a multiplicative chain and preserves an invoice-known symbol', async () => {
    const { composer } = build({
      lines: [
        {
          id: 'a',
          formula: 'base * pctA * pctB * quantity',
          symbols: [
            { name: 'base', value: 1000, sourcePath: 'attrib:sum_insured' },
            {
              name: 'pctA',
              value: 0.01,
              sourcePath: 'customs_clearance:pricingContext',
            },
            {
              name: 'pctB',
              value: 0.4,
              sourcePath: 'documentation_handling:pricingContext',
            },
            // Model leaves a known symbol's value out — composer keeps the original 2.
            { name: 'quantity', value: null, sourcePath: 'unresolved' },
          ],
        },
      ],
    });

    const [row] = await composer.compose(
      set,
      [line()],
      'cluster',
      'org',
      'doc',
    );

    expect(row.formula).toBe('base * pctA * pctB * quantity');
    expect(row.symbols).toEqual({
      base: 1000,
      pctA: 0.01,
      pctB: 0.4,
      quantity: 2,
    });
    // End-to-end: the rewritten formula evaluates to 40% of (1% of 1000) × qty 2.
    expect(evaluateExpression(row.formula!, row.symbols!)).toBe(8);
    expect(row.logAdditions.join('\n')).toContain(
      'Composed referenced formula',
    );
  });

  it('composes an additive relation', async () => {
    const { composer } = build({
      lines: [
        {
          id: 'a',
          formula: 'base * pctA + flat',
          symbols: [
            { name: 'base', value: 1000, sourcePath: 'attrib:sum_insured' },
            {
              name: 'pctA',
              value: 0.01,
              sourcePath: 'customs_clearance:pricingContext',
            },
            {
              name: 'flat',
              value: 10,
              sourcePath: 'documentation_handling:pricingContext',
            },
          ],
        },
      ],
    });

    const [row] = await composer.compose(
      set,
      [line()],
      'cluster',
      'org',
      'doc',
    );

    expect(evaluateExpression(row.formula!, row.symbols!)).toBe(20);
  });

  it('chains through the referenced tier rate and preserves the formula scale', async () => {
    // "40% of the main marine rate" where the referenced service (ordinary_risks) is
    // TIERED — the composer must read the foodstuffs tier's rate (0.1) verbatim and keep
    // the 40% as a SEPARATE factor, not collapse both into one pre-scaled percentage.
    const { composer } = build({
      lines: [
        {
          id: 'a',
          formula: 'sum_insured * main_rate * contingency_factor / 100',
          symbols: [
            {
              name: 'sum_insured',
              value: 180455,
              sourcePath: 'attrib:sum_insured',
            },
            {
              name: 'main_rate',
              value: 0.1,
              sourcePath:
                'ordinary_risks:main_voyage_foodstuffs:attrib:premium',
            },
            {
              name: 'contingency_factor',
              value: 0.4,
              sourcePath: 'contingency_cover:pricingContext',
            },
          ],
        },
      ],
    });

    const composable: ComposableLine = {
      id: 'a',
      description: 'OR + War premium — foodstuffs consignment',
      canonicalName: 'contingency_cover',
      formula: 'sum_insured * rate / 100',
      symbols: { sum_insured: 180455, rate: null },
      attributes: { sum_insured: 180455 },
      references: [
        {
          fromCanonical: 'contingency_cover',
          referencedCanonical: 'ordinary_risks',
          relation: '40% of the main marine rate',
          referencedTierSlug: null,
        },
      ],
    };

    const [row] = await composer.compose(
      set,
      [composable],
      'cluster',
      'org',
      'doc',
    );

    // 180455 * 0.1 * 0.40 / 100 = 72.182 — not the mis-scaled 721.82.
    expect(evaluateExpression(row.formula!, row.symbols!)).toBeCloseTo(
      72.18,
      2,
    );
    expect(row.symbols).toMatchObject({
      main_rate: 0.1,
      contingency_factor: 0.4,
    });
    // The rate came from the REFERENCED service's tier, not contingency_cover's own text.
    expect(row.logAdditions.join('\n')).toContain(
      'ordinary_risks:main_voyage_foodstuffs:attrib:premium',
    );
  });

  it('rejects an invalid rewrite (undeclared symbol) and returns no row', async () => {
    const { composer } = build({
      lines: [
        {
          id: 'a',
          formula: 'base * pctZ', // pctZ is not declared in symbols
          symbols: [
            { name: 'base', value: 1000, sourcePath: 'attrib:sum_insured' },
          ],
        },
      ],
    });

    const rows = await composer.compose(set, [line()], 'cluster', 'org', 'doc');
    expect(rows).toEqual([]);
  });

  it('returns no row when the model cannot express the relationship (null formula)', async () => {
    const { composer } = build({
      lines: [{ id: 'a', formula: null, symbols: [] }],
    });

    const rows = await composer.compose(set, [line()], 'cluster', 'org', 'doc');
    expect(rows).toEqual([]);
  });

  it('does not call the LLM when there are no composable lines', async () => {
    const { fake, composer } = build({ lines: [] });
    const rows = await composer.compose(set, [], 'cluster', 'org', 'doc');

    expect(rows).toEqual([]);
    expect(fake.calls).toHaveLength(0);
  });
});
