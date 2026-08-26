import type { StagedService } from '@nom/shared';
import { dedupeByBand } from './utils';

const svc = (over: Partial<StagedService>): StagedService => ({
  id: 'id',
  canonicalName: 'admin_fee',
  canonicalDescription: '',
  title: '',
  category: null,
  tier: null,
  tierSlug: null,
  pricingContext: '',
  pricingRef: null,
  attributes: {},
  meta: {
    foundAt: null,
    sourceText: '',
    contentId: 'c',
    sectionLabel: '',
    position: 0,
    sectionContext: null,
  },
  log: '',
  ...over,
});

describe('dedupeByBand', () => {
  it('collapses lines sharing (canonicalName, tierSlug), keeping the last', () => {
    const out = dedupeByBand([
      svc({ id: 'a', canonicalName: 'admin_fee', tierSlug: null }),
      svc({ id: 'b', canonicalName: 'admin_fee', tierSlug: null }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('b'); // last wins
    expect(out[0].log).toContain('merged duplicate of a');
  });

  it('keeps lines with distinct tierSlug under the same canonical', () => {
    const out = dedupeByBand([
      svc({ id: 'a', canonicalName: 'haulage', tierSlug: '20ft' }),
      svc({ id: 'b', canonicalName: 'haulage', tierSlug: '40ft' }),
    ]);
    expect(out.map((s) => s.id).sort()).toEqual(['a', 'b']);
  });
});
