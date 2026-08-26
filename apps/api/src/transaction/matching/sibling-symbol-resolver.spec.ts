import { ATTRIBUTE_SETS } from '../../attribute-set';
import { FakeStructuredExtractor } from '../../infra/llm/fake.structured-extractor';
import {
  SiblingSymbolResolver,
  type SiblingResolvableLine,
} from './sibling-symbol-resolver';
import type { ResolvedLine } from '../schemas/resolve-schema';

// SiblingSymbolResolver fills the null formula symbols of sibling_ref lines from their
// referenced siblings' billed amounts and appends the provenance to the audit log.
// Driven here with a FakeStructuredExtractor returning canned resolutions.

const set = ATTRIBUTE_SETS.invoice;

function line(
  over: Partial<SiblingResolvableLine> = {},
): SiblingResolvableLine {
  return {
    id: 'a',
    description: 'Admin fee 5% of PSA & Depot',
    formula: 'base * pct',
    symbols: { base: null, pct: 0.05 },
    references: [
      { id: 'b', description: 'PSA charge', billedAmount: 100 },
      { id: 'c', description: 'Depot handling', billedAmount: 60 },
    ],
    ...over,
  };
}

// Build a resolver whose LLM returns `lines` verbatim as the resolution result.
function build(lines: ResolvedLine[]) {
  const fake = new FakeStructuredExtractor(() => ({ lines }));
  return { fake, resolver: new SiblingSymbolResolver(fake) };
}

describe('SiblingSymbolResolver', () => {
  it('fills a null symbol from the siblings and logs its source path', async () => {
    const { fake, resolver } = build([
      {
        id: 'a',
        resolvedSymbols: [
          { name: 'base', value: 160, sourcePath: 'sum(sibling:b, sibling:c)' },
        ],
      },
    ]);
    const [row] = await resolver.resolve(set, [line()], 'org-1', 'doc-1');

    expect(row.symbols).toEqual({ base: 160, pct: 0.05 });
    expect(row.logAdditions.join('\n')).toContain(
      'Resolved "base" = 160 (source: sum(sibling:b, sibling:c))',
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
          { name: 'base', value: null, sourcePath: 'unresolved' },
        ],
      },
    ]);
    const [row] = await resolver.resolve(set, [line()], 'org-1', 'doc-1');

    expect(row.symbols).toEqual({ base: null, pct: 0.05 });
    expect(row.logAdditions.join('\n')).toContain('Could not resolve "base"');
  });

  it('never overwrites an already-known (non-null) symbol', async () => {
    const { resolver } = build([
      {
        id: 'a',
        resolvedSymbols: [
          { name: 'pct', value: 0.99, sourcePath: 'sibling:b' },
        ],
      },
    ]);
    const [row] = await resolver.resolve(set, [line()], 'org-1', 'doc-1');

    // pct stays 0.05; base was never addressed → logged as unresolvable.
    expect(row.symbols).toEqual({ base: null, pct: 0.05 });
    expect(row.logAdditions.join('\n')).toContain('Could not resolve "base"');
  });

  it('threads the vendor rules into the resolver system prompt', async () => {
    const { fake, resolver } = build([{ id: 'a', resolvedSymbols: [] }]);
    await resolver.resolve(
      set,
      [line()],
      'org-1',
      'doc-1',
      'Handling fees sum their siblings.',
    );

    expect(fake.calls[0].system).toContain('Vendor rules');
    expect(fake.calls[0].system).toContain('Handling fees sum their siblings.');
  });

  it('returns an empty array for no sibling lines without calling the LLM', async () => {
    const { fake, resolver } = build([]);
    const rows = await resolver.resolve(set, [], 'org-1', 'doc-1');

    expect(rows).toEqual([]);
    expect(fake.calls).toHaveLength(0);
  });
});
