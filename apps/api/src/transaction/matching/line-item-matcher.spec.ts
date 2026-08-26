import { LINE_ITEM_MATCH_KINDS } from '@nom/shared';
import type { DocumentMetadata } from '@nom/shared';
import { ATTRIBUTE_SETS } from '../../attribute-set';
import { FakeStructuredExtractor } from '../../infra/llm/fake.structured-extractor';
import type {
  CanonicalRegistryEntry,
  CanonicalRegistryRepository,
  TierRegistryEntry,
} from '../../infra/graph/canonical-registry.repository';
import type { DocumentLineItem } from '../../infra/graph/line-item-graph.repository';
import { LineItemMatcher } from './line-item-matcher';
import type { LineMatch } from '../schemas/match-schema';

// LineItemMatcher.match reconciles one invoice section at a time and coerces any
// model output that names a canonical/sibling not actually present to "unmatched",
// so the downstream graph write never fails an integrity assertion. These tests
// drive it with a FakeStructuredExtractor returning canned verdicts.

const set = ATTRIBUTE_SETS.invoice;
const registry: CanonicalRegistryEntry[] = [
  { canonicalName: 'local_haulage', description: null },
];
const tiers: TierRegistryEntry[] = [];
const meta: DocumentMetadata = { isFinancial: false, attributeSet: null };
// Registry is always tiny in these tests (< the pre-filter threshold), so the
// filter never queries this — a stub is enough.
const fakeCanonicalRegistry = {
  searchCanonicals: () => Promise.resolve([]),
} as unknown as CanonicalRegistryRepository;

// Minimal line — only the fields the matcher reads. Cast covers the rest.
function line(
  id: string,
  over: Partial<DocumentLineItem> = {},
): DocumentLineItem {
  return {
    id,
    description: `desc ${id}`,
    invoiceRef: 'INV-1',
    sectionLabel: 'INV-1',
    attributes: {},
    initialKind: null,
    initialCanonical: null,
    initialTierSlug: null,
    initialRefSummary: null,
    log: [`origin · ${id}`],
    ...over,
  } as DocumentLineItem;
}

// A full LineMatch from a partial (defaults to unmatched).
function mk(id: string, over: Partial<LineMatch> = {}): LineMatch {
  return {
    id,
    reasoning: {
      kind: '',
      canonical: '',
      tier: '',
      references: '',
      formula: '',
    },
    kind: LINE_ITEM_MATCH_KINDS.UNMATCHED,
    canonicalName: null,
    tierSlug: null,
    referencedIds: [],
    formula: null,
    symbols: [],
    ...over,
  };
}

// The human turn is a toTable() rendering (`id | description | ...`), not JSON —
// pull just the id column back out.
function parseIds(human: string): Array<{ id: string }> {
  const [header, ...rows] = human.split('\n');
  const idIndex = header.split(' | ').indexOf('id');
  return rows.map((row) => ({ id: row.split(' | ')[idIndex] }));
}

// Build a matcher whose LLM returns whatever `responder` produces for the section's
// input lines (parsed from the human turn the matcher sends).
function build(responder: (lines: Array<{ id: string }>) => LineMatch[]) {
  const fake = new FakeStructuredExtractor((req) => ({
    matches: responder(parseIds(req.human as string)),
  }));
  return {
    fake,
    matcher: new LineItemMatcher(fake, fakeCanonicalRegistry),
  };
}

describe('LineItemMatcher', () => {
  it('groups by invoice — one LLM call per invoiceRef', async () => {
    const { fake, matcher } = build((lines) => lines.map((l) => mk(l.id)));
    await matcher.match(
      set,
      [
        line('a', { invoiceRef: 'INV-1' }),
        line('b', { invoiceRef: 'INV-1' }),
        line('c', { invoiceRef: 'INV-2' }),
      ],
      registry,
      tiers,
      'org-1',
      'vendor-1',
      'doc-1',
      meta,
    );
    expect(fake.calls).toHaveLength(2);
    // reference threaded for fine-tuning log capture (sourceType/id per document)
    expect(fake.calls[0].options?.reference).toEqual({
      organizationId: 'org-1',
      sourceType: 'document',
      sourceId: 'doc-1',
    });
  });

  it("sends each line's sectionContext into the match payload for disambiguation", async () => {
    const { fake, matcher } = build((lines) => lines.map((l) => mk(l.id)));
    await matcher.match(
      set,
      [line('a', { sectionContext: 'Bill Period: Balance Stock (Feb 2025)' })],
      registry,
      tiers,
      'org-1',
      'vendor-1',
      'doc-1',
      meta,
    );
    expect(fake.calls[0].human).toContain('Balance Stock (Feb 2025)');
    expect(fake.calls[0].system).toContain('sectionContext');
  });

  it('service_match to a known canonical creates a BILLED_AS edge', async () => {
    const { matcher } = build(() => [
      mk('a', {
        kind: LINE_ITEM_MATCH_KINDS.SERVICE_MATCH,
        canonicalName: 'Local Haulage',
        tierSlug: '40ft',
        reasoning: {
          kind: 'bills a known service',
          canonical: 'matches Local Haulage',
          tier: '40ft container size',
          references: '',
          formula: '',
        },
      }),
    ]);
    const out = await matcher.match(
      set,
      [line('a')],
      registry,
      tiers,
      'org-1',
      'vendor-1',
      'doc-1',
      meta,
    );

    expect(out.rows[0].reasoning).toEqual({
      kind: 'bills a known service',
      canonical: 'matches Local Haulage',
      tier: '40ft container size',
      references: '',
      formula: '',
    });

    expect(out.serviceMatches).toEqual([
      { lineItemId: 'a', canonicalName: 'local_haulage', tierSlug: '40ft' },
    ]);
    expect(out.counts).toEqual({
      serviceMatch: 1,
      siblingRef: 0,
      unmatched: 0,
    });
    expect(out.rows[0].matchKind).toBe(LINE_ITEM_MATCH_KINDS.SERVICE_MATCH);
    expect(out.rows[0].log.join('\n')).toContain(
      'Matched to rate-card service "local_haulage" (tier "40ft")',
    );
  });

  it('service_match to an unknown canonical is coerced to unmatched (no edge)', async () => {
    const { matcher } = build(() => [
      mk('a', {
        kind: LINE_ITEM_MATCH_KINDS.SERVICE_MATCH,
        canonicalName: 'Made Up Service',
      }),
    ]);
    const out = await matcher.match(
      set,
      [line('a')],
      registry,
      tiers,
      'org-1',
      'vendor-1',
      'doc-1',
      meta,
    );

    expect(out.serviceMatches).toHaveLength(0);
    expect(out.counts.unmatched).toBe(1);
    expect(out.rows[0].matchKind).toBe(LINE_ITEM_MATCH_KINDS.UNMATCHED);
    expect(out.rows[0].log.join('\n')).toContain(
      "is not in the vendor's registry",
    );
  });

  it('unmatched verdict tallies as unmatched with a log line', async () => {
    const { matcher } = build(() => [mk('a')]);
    const out = await matcher.match(
      set,
      [line('a')],
      registry,
      tiers,
      'org-1',
      'vendor-1',
      'doc-1',
      meta,
    );

    expect(out.counts).toEqual({
      serviceMatch: 0,
      siblingRef: 0,
      unmatched: 1,
    });
    expect(out.rows[0].log.join('\n')).toContain(
      'no rate-card service or sibling reference',
    );
  });

  it('sibling_ref links to a sibling in-section, both directions logged', async () => {
    const { matcher } = build(() => [
      mk('a', {
        kind: LINE_ITEM_MATCH_KINDS.SIBLING_REF,
        referencedIds: ['b'],
      }),
      mk('b'),
    ]);
    const out = await matcher.match(
      set,
      [line('a'), line('b', { description: 'PSA charge' })],
      registry,
      tiers,
      'org-1',
      'vendor-1',
      'doc-1',
      meta,
    );

    expect(out.references).toEqual([{ fromId: 'a', toId: 'b' }]);
    expect(out.counts).toEqual({
      serviceMatch: 0,
      siblingRef: 1,
      unmatched: 1,
    });

    const rowA = out.rows.find((r) => r.id === 'a')!;
    const rowB = out.rows.find((r) => r.id === 'b')!;
    expect(rowA.log.join('\n')).toContain(
      'References sibling "PSA charge" (id b)',
    );
    // Bidirectional: the referenced sibling records it was included.
    expect(rowB.log.join('\n')).toContain(
      'Referenced by sibling "desc a" (id a)',
    );
  });

  it('sibling_ref to a self/out-of-section id is filtered — downgraded to unmatched', async () => {
    const { matcher } = build(() => [
      mk('a', {
        kind: LINE_ITEM_MATCH_KINDS.SIBLING_REF,
        referencedIds: ['a', 'not-in-section'],
      }),
    ]);
    const out = await matcher.match(
      set,
      [line('a')],
      registry,
      tiers,
      'org-1',
      'vendor-1',
      'doc-1',
      meta,
    );

    expect(out.references).toHaveLength(0);
    expect(out.counts.siblingRef).toBe(0);
    expect(out.counts.unmatched).toBe(1);
    expect(out.rows[0].matchKind).toBe(LINE_ITEM_MATCH_KINDS.UNMATCHED);
    expect(out.rows[0].log.join('\n')).toContain('downgraded to unmatched');
  });

  it('coerces a line the model dropped to unmatched', async () => {
    // Responder returns nothing for 'b' → validate() must backfill it.
    const { matcher } = build((lines) =>
      lines.filter((l) => l.id === 'a').map((l) => mk(l.id)),
    );
    const out = await matcher.match(
      set,
      [line('a'), line('b')],
      registry,
      tiers,
      'org-1',
      'vendor-1',
      'doc-1',
      meta,
    );

    expect(out.counts.unmatched).toBe(2);
    expect(out.rows.map((r) => r.id).sort()).toEqual(['a', 'b']);
    // The dropped line ('b') still gets a structured reasoning fallback.
    const rowB = out.rows.find((r) => r.id === 'b')!;
    expect(rowB.reasoning).toEqual({
      kind: 'no match returned by model',
      canonical: '',
      tier: '',
      references: '',
      formula: '',
    });
  });

  it('accepts a corrected formula that validates and merges known symbol values', async () => {
    const { matcher } = build(() => [
      mk('a', {
        formula: 'rate * quantity',
        symbols: [
          { name: 'rate', value: null },
          { name: 'quantity', value: null }, // model dropped the invoice value
        ],
      }),
    ]);
    const out = await matcher.match(
      set,
      [
        line('a', {
          formula: 'rate * quantity +', // malformed original
          symbols: { rate: null, quantity: 2 },
        }),
      ],
      registry,
      tiers,
      'org-1',
      'vendor-1',
      'doc-1',
      meta,
    );

    expect(out.rows[0].formula).toBe('rate * quantity');
    // quantity's invoice value is preserved from the original; rate stays null.
    expect(out.rows[0].symbols).toEqual({ rate: null, quantity: 2 });
    expect(out.rows[0].log.join('\n')).toContain('Formula corrected');
  });

  it('rejects a still-invalid rewrite and keeps the original formula/symbols', async () => {
    const { matcher } = build(() => [
      mk('a', {
        formula: '(rate * quantity', // still malformed
        symbols: [
          { name: 'rate', value: null },
          { name: 'quantity', value: null },
        ],
      }),
    ]);
    const out = await matcher.match(
      set,
      [
        line('a', {
          formula: 'rate * quantity',
          symbols: { rate: null, quantity: 2 },
        }),
      ],
      registry,
      tiers,
      'org-1',
      'vendor-1',
      'doc-1',
      meta,
    );

    expect(out.rows[0].formula).toBe('rate * quantity');
    expect(out.rows[0].symbols).toEqual({ rate: null, quantity: 2 });
    expect(out.rows[0].log.join('\n')).toContain('rewrite rejected');
  });

  it('never overwrites an existing invoice symbol value the model got wrong', async () => {
    const { matcher } = build(() => [
      mk('a', {
        formula: 'rate * quantity',
        symbols: [
          { name: 'rate', value: null },
          { name: 'quantity', value: 1 }, // model wrongly re-reads 163 as 1
        ],
      }),
    ]);
    const out = await matcher.match(
      set,
      [
        line('a', {
          formula: 'rate * quantity',
          symbols: { rate: null, quantity: 163 },
        }),
      ],
      registry,
      tiers,
      'org-1',
      'vendor-1',
      'doc-1',
      meta,
    );

    // The extractor's 163 is preserved — the adjudicator cannot flip it to 1.
    expect(out.rows[0].symbols).toEqual({ rate: null, quantity: 163 });
  });

  it('adds a redeclared symbol as null for phase-3 resolution', async () => {
    const { matcher } = build(() => [
      mk('a', {
        formula: 'rate * quantity * (1 + gst)',
        symbols: [
          { name: 'rate', value: null },
          { name: 'quantity', value: 2 },
          { name: 'gst', value: null }, // brand-new symbol
        ],
      }),
    ]);
    const out = await matcher.match(
      set,
      [
        line('a', {
          formula: 'rate * quantity',
          symbols: { rate: null, quantity: 2 },
        }),
      ],
      registry,
      tiers,
      'org-1',
      'vendor-1',
      'doc-1',
      meta,
    );

    expect(out.rows[0].formula).toBe('rate * quantity * (1 + gst)');
    expect(out.rows[0].symbols).toEqual({ rate: null, quantity: 2, gst: null });
  });

  it('echoes an unchanged valid formula with no formula log', async () => {
    const { matcher } = build(() => [
      mk('a', {
        formula: 'rate * quantity',
        symbols: [
          { name: 'rate', value: null },
          { name: 'quantity', value: 2 },
        ],
      }),
    ]);
    const out = await matcher.match(
      set,
      [
        line('a', {
          formula: 'rate * quantity',
          symbols: { rate: null, quantity: 2 },
        }),
      ],
      registry,
      tiers,
      'org-1',
      'vendor-1',
      'doc-1',
      meta,
    );

    expect(out.rows[0].formula).toBe('rate * quantity');
    expect(out.rows[0].log.join('\n')).not.toContain('formula');
  });

  it('renders tier pricingContext into the match prompt (disambiguating text a bare name/description can lack)', async () => {
    const { fake, matcher } = build(() => [mk('a')]);
    const richTiers: TierRegistryEntry[] = [
      {
        canonicalName: 'empty_cartons_shipment_insurance',
        tierSlug: 'empty_cartons',
        label: 'Empty Cartons',
        pricingContext:
          'Ordinary risks including War (Waterborne) and SRCC risks. Rate is 0.05% of shipment value.',
        attributes: null,
      },
    ];
    await matcher.match(
      set,
      [line('a')],
      [
        {
          canonicalName: 'empty_cartons_shipment_insurance',
          description: 'Shipments of EMPTY CARTONS in containers.',
        },
      ],
      richTiers,
      'org-1',
      'vendor-1',
      'doc-1',
      meta,
    );

    expect(fake.calls[0].system).toContain(
      'Ordinary risks including War (Waterborne) and SRCC risks. Rate is 0.05% of shipment value.',
    );
  });

  it('keeps the first verdict when the model returns a duplicate id', async () => {
    const { matcher } = build(() => [
      mk('a', {
        kind: LINE_ITEM_MATCH_KINDS.SERVICE_MATCH,
        canonicalName: 'local_haulage',
      }),
      mk('a', { kind: LINE_ITEM_MATCH_KINDS.UNMATCHED }),
    ]);
    const out = await matcher.match(
      set,
      [line('a')],
      registry,
      tiers,
      'org-1',
      'vendor-1',
      'doc-1',
      meta,
    );

    expect(out.rows[0].matchKind).toBe(LINE_ITEM_MATCH_KINDS.SERVICE_MATCH);
  });
});
