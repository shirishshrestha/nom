import type { StagedService } from '@nom/shared';
import { applyEditForAmendment } from './staging.mapper';

const svc = (over: Partial<StagedService>): StagedService => ({
  id: 'id',
  canonicalName: 'admin_fee',
  canonicalDescription: '',
  title: 'Admin Fee',
  category: null,
  tier: null,
  tierSlug: null,
  pricingContext: 'per shipment',
  pricingRef: null,
  attributes: { price: 100 },
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

describe('applyEditForAmendment', () => {
  it('re-issues a genuinely-changed line under a new id and records the pair', () => {
    const committed = [svc({ id: 'a', attributes: { price: 100 } })];
    const { services, amendments } = applyEditForAmendment(
      committed,
      [{ id: 'a', attributes: { price: 150 } }],
      'user-1',
      3,
    );
    expect(amendments).toHaveLength(1);
    expect(amendments[0].priorId).toBe('a');
    expect(services[0].id).toBe(amendments[0].newId);
    expect(services[0].id).not.toBe('a');
    expect(services[0].attributes).toEqual({ price: 150 });
    expect(services[0].log).toContain('supersedes a');
  });

  it('is a no-op for an edit that changes nothing — same id, no amendment', () => {
    const committed = [svc({ id: 'a', attributes: { price: 100 } })];
    const { services, amendments } = applyEditForAmendment(
      committed,
      [{ id: 'a', attributes: { price: 100 } }],
      'user-1',
      3,
    );
    expect(amendments).toHaveLength(0);
    expect(services[0].id).toBe('a');
    expect(services[0].log).toBe('');
  });

  it('leaves untouched services unchanged', () => {
    const committed = [svc({ id: 'a' }), svc({ id: 'b' })];
    const { services, amendments } = applyEditForAmendment(
      committed,
      [{ id: 'a', title: 'New Title' }],
      'user-1',
      1,
    );
    expect(amendments.map((am) => am.priorId)).toEqual(['a']);
    expect(services.find((s) => s.id === 'b')).toBe(committed[1]);
  });

  it('throws on an unknown edit id', () => {
    expect(() =>
      applyEditForAmendment(
        [svc({ id: 'a' })],
        [{ id: 'ghost', attributes: { price: 1 } }],
        'user-1',
        1,
      ),
    ).toThrow('Unknown service id: ghost');
  });
});
