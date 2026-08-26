import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { CanonicalMatcher, RECONCILE_BATCH_SIZE } from './canonical-matcher';
import type { CanonicalMatchLine } from './canonical-matcher';
import { FakeStructuredExtractor } from '../../infra/llm/fake.structured-extractor';
import type { ExtractionRequest } from '../../infra/llm/structured-extractor.port';
import type { CanonicalRegistryRepository } from '../../infra/graph/canonical-registry.repository';
import { ATTRIBUTE_SETS } from '../../attribute-set';

const set = ATTRIBUTE_SETS.quotation;
// Registries are always tiny in these tests (< the pre-filter threshold), so the
// filter never queries this — a stub is enough.
const fakeCanonicalRegistry = {
  searchCanonicals: () => Promise.resolve([]),
} as unknown as CanonicalRegistryRepository;

const line = (
  id: string,
  canonicalName: string,
  title: string,
  sectionContext: string | null = null,
): CanonicalMatchLine => ({
  id,
  canonicalName,
  title,
  tier: null,
  pricingContext: 'per container',
  attributes: {
    price: 100,
    currency: 'SGD',
    unit: 'per container',
    remarks: null,
  },
  sectionContext,
});

// The human turn is a toTable() rendering (`id | title | ...`), not JSON — pull
// just the id column back out.
function parseIds(human: string): Array<{ id: string }> {
  const [header, ...rows] = human.split('\n');
  const idIndex = header.split(' | ').indexOf('id');
  return rows.map((row) => ({ id: row.split(' | ')[idIndex] }));
}

// Responder: echo each input line's id with an assigned canonical (by id), or keep.
type Assign = Record<
  string,
  {
    canonicalName: string;
    canonicalDescription: string;
    tierSlug?: string | null;
  }
>;
const responder = (assign: Assign) => (req: ExtractionRequest<unknown>) => {
  const lines = parseIds(req.human as string);
  return {
    assignments: lines.map((l) => ({
      id: l.id,
      canonicalName: assign[l.id]?.canonicalName ?? 'kept',
      canonicalDescription: assign[l.id]?.canonicalDescription ?? 'kept desc',
      tierSlug: assign[l.id]?.tierSlug ?? null,
    })),
  };
};

describe('CanonicalMatcher', () => {
  it('returns a Map keyed by id, offers the registry, and does NOT leak canonicalName into the payload', async () => {
    const fake = new FakeStructuredExtractor(
      responder({
        a: { canonicalName: 'haulage', canonicalDescription: 'Trucking.' },
        b: {
          canonicalName: 'customs_clearance',
          canonicalDescription: 'Clearing.',
        },
      }),
    );
    const matcher = new CanonicalMatcher(fake, fakeCanonicalRegistry);

    const result = await matcher.match(
      set,
      [line('a', 'old_a', 'Haulage'), line('b', 'old_b', 'Customs clearance')],
      [{ canonicalName: 'haulage', description: 'Trucking.' }],
      [],
      'org-1',
      'vendor-1',
      'doc-1',
    );

    expect(result.get('a')?.canonicalName).toBe('haulage');
    expect(result.get('b')?.canonicalName).toBe('customs_clearance');
    // existing registry name offered in the system prompt
    expect(fake.calls[0].system).toContain('haulage');
    // judging fields sent...
    expect(fake.calls[0].human).toContain('Customs clearance');
    // ...but the current canonicalName is stripped so it can't anchor the decision
    expect(fake.calls[0].human).not.toContain('old_a');
    // reference threaded for fine-tuning log capture
    expect(fake.calls[0].options?.reference).toEqual({
      organizationId: 'org-1',
      sourceType: 'document',
      sourceId: 'doc-1',
    });
  });

  it("sends each line's sectionContext into the match payload for disambiguation", async () => {
    const fake = new FakeStructuredExtractor(responder({}));
    const matcher = new CanonicalMatcher(fake, fakeCanonicalRegistry);

    await matcher.match(
      set,
      [line('a', 'old_a', 'Storage', 'Bill Period: Balance Stock (Feb 2025)')],
      [],
      [],
      'org-1',
      'vendor-1',
      'doc-1',
    );

    expect(fake.calls[0].human).toContain('Balance Stock (Feb 2025)');
    // and the prompt documents the column so the model uses it
    expect(fake.calls[0].system).toContain('sectionContext');
  });

  it('instructs the model to exclude tier from the name and converge same-concept lines with an empty registry', async () => {
    const fake = new FakeStructuredExtractor(responder({}));
    const matcher = new CanonicalMatcher(fake, fakeCanonicalRegistry);

    await matcher.match(
      set,
      [line('a', 'x', 'Local haulage - 20ft')],
      [],
      [],
      'org-1',
      'vendor-1',
      'doc-1',
    );

    const system = fake.calls[0].system;
    // tier must not be baked into the canonical name
    expect(system).toContain('local_haulage');
    expect(system).toContain('tier');
    // self-anchoring: converge even when the registry is empty
    expect(system.toLowerCase()).toContain('empty');
  });

  it('threads vendor rules into the system prompt', async () => {
    const fake = new FakeStructuredExtractor(responder({}));
    const matcher = new CanonicalMatcher(fake, fakeCanonicalRegistry);

    await matcher.match(
      set,
      [line('a', 'old_a', 'Haulage')],
      [],
      [],
      'org-1',
      'vendor-1',
      'doc-1',
      'Always split multi-leg haulage.',
    );

    expect(fake.calls[0].system).toContain('Always split multi-leg haulage.');
  });

  it('normalizes the returned canonical name', async () => {
    const fake = new FakeStructuredExtractor(
      responder({
        a: { canonicalName: 'Customs Clearance', canonicalDescription: 'x' },
      }),
    );
    const matcher = new CanonicalMatcher(fake, fakeCanonicalRegistry);

    const result = await matcher.match(
      set,
      [line('a', 'x', 'Customs clearance')],
      [],
      [],
      'org-1',
      'vendor-1',
      'doc-1',
    );
    expect(result.get('a')?.canonicalName).toBe('customs_clearance');
  });

  it('short-circuits with no LLM call when there are no lines', async () => {
    const fake = new FakeStructuredExtractor(() => ({ assignments: [] }));
    const matcher = new CanonicalMatcher(fake, fakeCanonicalRegistry);

    const result = await matcher.match(
      set,
      [],
      [],
      [],
      'org-1',
      'vendor-1',
      'doc-1',
    );

    expect(result.size).toBe(0);
    expect(fake.calls).toHaveLength(0);
  });

  it('batches by canonical group without splitting a group across batches', async () => {
    // Group A fills a whole batch; group B forces a second one.
    const aLines = Array.from({ length: RECONCILE_BATCH_SIZE }, (_, i) =>
      line(`a${i}`, 'grp_a', 'A'),
    );
    const bLines = [line('b0', 'grp_b', 'B')];
    const fake = new FakeStructuredExtractor(responder({}));
    const matcher = new CanonicalMatcher(fake, fakeCanonicalRegistry);

    await matcher.match(
      set,
      [...aLines, ...bLines],
      [],
      [],
      'org-1',
      'vendor-1',
      'doc-1',
    );

    expect(fake.calls).toHaveLength(2);
    const batch0 = parseIds(fake.calls[0].human as string);
    const batch1 = parseIds(fake.calls[1].human as string);
    expect(batch0).toHaveLength(RECONCILE_BATCH_SIZE); // group A intact
    expect(batch1).toHaveLength(1); // group B
  });

  it('feeds names minted in an earlier batch forward into a later batch (cross-batch convergence)', async () => {
    // Group A fills batch 0 and is assigned a fresh name; group B is batch 1.
    // Sentinel name that never appears in prompt boilerplate, so a hit means feed-forward.
    const minted = 'zzz_sentinel_concept';
    const aLines = Array.from({ length: RECONCILE_BATCH_SIZE }, (_, i) =>
      line(`a${i}`, 'grp_a', 'A'),
    );
    const bLines = [line('b0', 'grp_b', 'Other')];
    const fake = new FakeStructuredExtractor(
      responder(
        Object.fromEntries(
          aLines.map((l) => [
            l.id,
            { canonicalName: minted, canonicalDescription: 'Trucking.' },
          ]),
        ),
      ),
    );
    const matcher = new CanonicalMatcher(fake, fakeCanonicalRegistry);

    await matcher.match(
      set,
      [...aLines, ...bLines],
      [],
      [],
      'org-1',
      'vendor-1',
      'doc-1',
    ); // empty registries

    expect(fake.calls).toHaveLength(2);
    // batch 0's system prompt had nothing to offer (empty registry)...
    expect(fake.calls[0].system).not.toContain(minted);
    // ...but batch 1 sees the name minted by batch 0.
    expect(fake.calls[1].system).toContain(minted);
  });

  it('splits an over-merged group into two canonical names (one batch)', async () => {
    const fake = new FakeStructuredExtractor(
      responder({
        x: {
          canonicalName: 'customs_clearance',
          canonicalDescription: 'Clearing.',
        },
        y: {
          canonicalName: 'customs_inspection',
          canonicalDescription: 'Inspecting.',
        },
      }),
    );
    const matcher = new CanonicalMatcher(fake, fakeCanonicalRegistry);

    const result = await matcher.match(
      set,
      [
        line('x', 'customs_clearance', 'Customs clearance'),
        line('y', 'customs_clearance', 'Customs inspection'),
      ],
      [],
      [],
      'org-1',
      'vendor-1',
      'doc-1',
    );

    expect(result.get('x')?.canonicalName).toBe('customs_clearance');
    expect(result.get('y')?.canonicalName).toBe('customs_inspection');
    // both share the current canonicalName → judged in a single batch
    expect(fake.calls).toHaveLength(1);
  });

  it('warns on an over-specified (member-list) tierSlug but never truncates the MERGE key', async () => {
    const longSlug = 'spices_nuts_dried_fruits_pulses_rice';
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const fake = new FakeStructuredExtractor(
      responder({
        a: {
          canonicalName: 'all_risks_main_voyage',
          canonicalDescription: 'x',
          tierSlug: longSlug,
        },
      }),
    );
    const matcher = new CanonicalMatcher(fake, fakeCanonicalRegistry);

    const result = await matcher.match(
      set,
      [line('a', 'all_risks_main_voyage', 'Spices')],
      [],
      [],
      'org-1',
      'vendor-1',
      'doc-1',
    );

    expect(result.get('a')?.tierSlug).toBe(longSlug); // intact
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('long tierSlug'));
    warn.mockRestore();
  });

  it('drops the transient nameBasis from the returned assignment', async () => {
    const fake = new FakeStructuredExtractor(
      (req: ExtractionRequest<unknown>) => {
        const lines = parseIds(req.human as string);
        return {
          assignments: lines.map((l) => ({
            id: l.id,
            nameBasis: 'concept=x; axis=none; grain=none',
            canonicalName: 'x',
            canonicalDescription: 'd',
            tierSlug: null,
          })),
        };
      },
    );
    const matcher = new CanonicalMatcher(fake, fakeCanonicalRegistry);

    const result = await matcher.match(
      set,
      [line('a', 'x', 'X')],
      [],
      [],
      'org-1',
      'vendor-1',
      'doc-1',
    );

    expect('nameBasis' in (result.get('a') as object)).toBe(false);
  });

  it('normalizes the returned tier slug; null stays null for a flat line', async () => {
    const fake = new FakeStructuredExtractor(
      responder({
        a: {
          canonicalName: 'local_haulage',
          canonicalDescription: 'Trucking.',
          tierSlug: '20 FT', // raw label — must be normalized
        },
        b: {
          canonicalName: 'admin_fee',
          canonicalDescription: 'x',
          tierSlug: null, // flat line
        },
      }),
    );
    const matcher = new CanonicalMatcher(fake, fakeCanonicalRegistry);

    const result = await matcher.match(
      set,
      [line('a', 'local_haulage', '20ft'), line('b', 'admin_fee', 'Admin fee')],
      [],
      [],
      'org-1',
      'vendor-1',
      'doc-1',
    );

    expect(result.get('a')?.tierSlug).toBe('20_ft');
    expect(result.get('b')?.tierSlug).toBeNull();
  });

  it('offers a registry tier slug and feeds minted slugs forward across batches', async () => {
    // Group A fills batch 0 and mints a sentinel slug; batch 1 must see it.
    const mintedSlug = 'zzz_sentinel_slug';
    const aLines = Array.from({ length: RECONCILE_BATCH_SIZE }, (_, i) =>
      line(`a${i}`, 'grp_a', 'A'),
    );
    const bLines = [line('b0', 'grp_b', 'Other')];
    const fake = new FakeStructuredExtractor(
      responder(
        Object.fromEntries(
          aLines.map((l) => [
            l.id,
            {
              canonicalName: 'grp_a',
              canonicalDescription: 'A.',
              tierSlug: mintedSlug,
            },
          ]),
        ),
      ),
    );
    const matcher = new CanonicalMatcher(fake, fakeCanonicalRegistry);

    await matcher.match(
      set,
      [...aLines, ...bLines],
      // tiers render only under known canonicals, so grp_a must be in the registry
      [{ canonicalName: 'grp_a', description: 'A.' }],
      // a pre-existing registry slug is offered from batch 0 onward
      [
        {
          canonicalName: 'grp_a',
          tierSlug: 'seed_slug',
          label: 'Seed',
          pricingContext: null,
          attributes: null,
        },
      ],
      'org-1',
      'vendor-1',
      'doc-1',
    );

    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0].system).toContain('seed_slug');
    expect(fake.calls[0].system).not.toContain(mintedSlug);
    expect(fake.calls[1].system).toContain(mintedSlug);
  });
});
