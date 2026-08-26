import { jest } from '@jest/globals';
import {
  filterRegistryForBatch,
  REGISTRY_FILTER_THRESHOLD,
} from './registry-filter';
import type { CanonicalRegistryRepository } from '../infra/graph/canonical-registry.repository';

function bigRegistry(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    canonicalName: `service_${i}`,
    description: null,
  }));
}

describe('filterRegistryForBatch', () => {
  it('returns the registry unfiltered at or below the threshold, without querying', async () => {
    const searchCanonicals = jest.fn(() => Promise.resolve([]));
    const search = {
      searchCanonicals,
    } as unknown as CanonicalRegistryRepository;
    const registry = bigRegistry(REGISTRY_FILTER_THRESHOLD);

    const result = await filterRegistryForBatch(
      search,
      'org-1',
      'vendor-1',
      registry,
      [],
      'ocean freight',
      [],
    );

    expect(result.registry).toBe(registry);
    expect(searchCanonicals).not.toHaveBeenCalled();
  });

  it('counts tier rows toward the gate — few canonicals but many tiers still filters', async () => {
    const searchCanonicals = jest.fn(() => Promise.resolve(['service_0']));
    const search = {
      searchCanonicals,
    } as unknown as CanonicalRegistryRepository;
    const registry = bigRegistry(10);
    // 10 canonicals + 51 tiers = 61 > threshold, so the filter must engage.
    const tiers = Array.from({ length: 51 }, (_, i) => ({
      canonicalName: `service_${i % 10}`,
      tierSlug: `t_${i}`,
      label: null,
      pricingContext: null,
      attributes: null,
    }));

    const result = await filterRegistryForBatch(
      search,
      'org-1',
      'vendor-1',
      registry,
      tiers,
      'ocean freight',
      [],
    );

    expect(searchCanonicals).toHaveBeenCalled();
    expect(result.registry.map((c) => c.canonicalName)).toEqual(['service_0']);
    // only tiers under the kept canonical survive
    expect(result.tiers.every((t) => t.canonicalName === 'service_0')).toBe(
      true,
    );
  });

  it('above the threshold, narrows to search results plus every current guess', async () => {
    const searchCanonicals = jest.fn(() =>
      Promise.resolve(['service_1', 'service_2']),
    );
    const search = {
      searchCanonicals,
    } as unknown as CanonicalRegistryRepository;
    const registry = bigRegistry(REGISTRY_FILTER_THRESHOLD + 1);
    const tiers = [
      {
        canonicalName: 'service_1',
        tierSlug: '20ft',
        label: null,
        pricingContext: null,
        attributes: null,
      },
      {
        canonicalName: 'service_9',
        tierSlug: '40ft',
        label: null,
        pricingContext: null,
        attributes: null,
      },
    ];

    const result = await filterRegistryForBatch(
      search,
      'org-1',
      'vendor-1',
      registry,
      tiers,
      'ocean freight',
      ['Service 9'], // a raw current-guess, not yet normalized
    );

    expect(searchCanonicals).toHaveBeenCalledWith(
      'org-1',
      'vendor-1',
      'ocean freight',
      expect.any(Number),
    );
    expect(result.registry.map((c) => c.canonicalName).sort()).toEqual([
      'service_1',
      'service_2',
      'service_9',
    ]);
    // tiers are filtered by the same keep-set — service_1 kept, service_9 kept (the
    // guess), the rest of the registry's tiers dropped.
    expect(result.tiers.map((t) => t.canonicalName).sort()).toEqual([
      'service_1',
      'service_9',
    ]);
  });
});
