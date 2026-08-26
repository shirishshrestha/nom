import { ATTRIBUTE_SETS } from '../../attribute-set';
import { FakeStructuredExtractor } from '../../infra/llm/fake.structured-extractor';
import { SymbolResolver, type ResolvableLine } from './symbol-resolver';
import {
  buildResolveSchema,
  type ResolvedLine,
} from '../schemas/resolve-schema';

// SymbolResolver fills the null formula symbols of already-matched lines from the
// rate-card cluster and appends the provenance to the audit log. Driven here with a
// FakeStructuredExtractor returning canned resolutions.

const set = ATTRIBUTE_SETS.invoice;
const cluster = '- "Haulage"\n    · slug 20ft · attrib: unit_rate=220';

function line(over: Partial<ResolvableLine> = {}): ResolvableLine {
  return {
    id: 'a',
    description: 'Haulage 20ft',
    canonicalName: 'Haulage',
    tierSlug: '20ft',
    formula: 'rate * quantity',
    symbols: { rate: null, quantity: 2 },
    guidance: null,
    ...over,
  };
}

// Build a resolver whose LLM returns `lines` verbatim as the resolution result.
function build(lines: ResolvedLine[]) {
  const fake = new FakeStructuredExtractor(() => ({ lines }));
  return { fake, resolver: new SymbolResolver(fake) };
}

describe('SymbolResolver', () => {
  it('fills a null symbol and logs its source path', async () => {
    const { fake, resolver } = build([
      {
        id: 'a',
        resolvedSymbols: [
          {
            name: 'rate',
            value: 220,
            sourcePath: 'Haulage:20ft:attrib:unit_rate',
          },
        ],
      },
    ]);
    const [row] = await resolver.resolve(
      set,
      [line()],
      cluster,
      'org-1',
      'doc-1',
    );

    expect(row.symbols).toEqual({ rate: 220, quantity: 2 });
    expect(row.logAdditions.join('\n')).toContain(
      'Resolved "rate" = 220 (source: Haulage:20ft:attrib:unit_rate)',
    );
    // reference threaded for fine-tuning log capture
    expect(fake.calls[0].options?.reference).toEqual({
      organizationId: 'org-1',
      sourceType: 'document',
      sourceId: 'doc-1',
    });
  });

  it('leaves a symbol null and logs when the model cannot resolve it', async () => {
    const { resolver } = build([
      {
        id: 'a',
        resolvedSymbols: [
          { name: 'rate', value: null, sourcePath: 'unresolved' },
        ],
      },
    ]);
    const [row] = await resolver.resolve(
      set,
      [line()],
      cluster,
      'org-1',
      'doc-1',
    );

    expect(row.symbols).toEqual({ rate: null, quantity: 2 });
    expect(row.logAdditions.join('\n')).toContain('Could not resolve "rate"');
  });

  it('never overwrites an already-known (non-null) symbol', async () => {
    const { resolver } = build([
      {
        id: 'a',
        resolvedSymbols: [
          {
            name: 'quantity',
            value: 99,
            sourcePath: 'Haulage:20ft:attrib:qty',
          },
        ],
      },
    ]);
    const [row] = await resolver.resolve(
      set,
      [line()],
      cluster,
      'org-1',
      'doc-1',
    );

    // quantity stays 2; rate was never addressed → logged as unresolvable.
    expect(row.symbols).toEqual({ rate: null, quantity: 2 });
    expect(row.logAdditions.join('\n')).toContain('Could not resolve "rate"');
  });

  it('overrides a non-null symbol only when the source is reviewer guidance', async () => {
    const { resolver } = build([
      {
        id: 'a',
        resolvedSymbols: [
          { name: 'quantity', value: 99, sourcePath: 'guidance' },
        ],
      },
    ]);
    const [row] = await resolver.resolve(
      set,
      [line({ guidance: 'the quantity is 99, not 2' })],
      cluster,
      'org-1',
      'doc-1',
    );

    expect(row.symbols).toEqual({ rate: null, quantity: 99 });
    expect(row.logAdditions.join('\n')).toContain(
      'Overrode "quantity" 2 → 99 by reviewer guidance',
    );
  });

  it('serializes a matched flat (untiered) line\'s tierSlug as "flat", not "—"', async () => {
    const { fake, resolver } = build([{ id: 'a', resolvedSymbols: [] }]);
    await resolver.resolve(
      set,
      [
        line({
          description: 'Container admin fee',
          canonicalName: 'container_admin',
          tierSlug: null,
          formula: 'rate',
          symbols: { rate: null },
        }),
      ],
      cluster,
      'org-1',
      'doc-1',
    );

    // A matched line with a null tierSlug must present "flat" (mirroring the cluster's
    // "slug flat") so the model bridges to its rate — never the "—" that also means "no match".
    expect(fake.calls[0].human).toContain('flat');
  });

  it('threads the vendor rules into the resolver system prompt', async () => {
    const { fake, resolver } = build([{ id: 'a', resolvedSymbols: [] }]);
    await resolver.resolve(
      set,
      [line()],
      cluster,
      'org-1',
      'doc-1',
      'Rates are stored as percentages.',
    );

    expect(fake.calls[0].system).toContain('Vendor rules');
    expect(fake.calls[0].system).toContain('Rates are stored as percentages.');
  });

  it('orders each resolved symbol sourcePath before value', () => {
    const symbol =
      buildResolveSchema().shape.lines.element.shape.resolvedSymbols.element
        .shape;
    const keys = Object.keys(symbol);
    expect(keys.indexOf('sourcePath')).toBeLessThan(keys.indexOf('value'));
  });

  it('returns an empty array for no matched lines without calling the LLM', async () => {
    const { fake, resolver } = build([]);
    const rows = await resolver.resolve(set, [], cluster, 'org-1', 'doc-1');

    expect(rows).toEqual([]);
    expect(fake.calls).toHaveLength(0);
  });
});
