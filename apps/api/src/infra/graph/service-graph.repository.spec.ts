import { jest } from '@jest/globals';
import { ServiceGraphRepository } from './service-graph.repository';
import { GraphWriteError } from './graph-error';
import type { Neo4jService } from '@nom/neo4j';

const input = {
  tenantId: 'org-1',
  documentId: 'doc-1',
  vendorId: 'vendor-1',
  attributeSet: 'quotation',
  validFrom: null,
  validTo: null,
  stagingId: 'staging-1',
  version: 1,
  now: '2026-01-01T00:00:00.000Z',
  rows: [],
};

function record(counts: Record<string, number>) {
  return { get: (k: string) => ({ toNumber: () => counts[k] }) };
}

describe('ServiceGraphRepository', () => {
  it('returns canonical + service counts from the write record', async () => {
    const neo4j = {
      write: jest.fn(() =>
        Promise.resolve([record({ canonicalCount: 2, serviceCount: 5 })]),
      ),
    } as unknown as Neo4jService;
    const repo = new ServiceGraphRepository(neo4j);

    const result = await repo.commitServices(input);
    expect(result).toEqual({ canonicalCount: 2, serviceCount: 5 });
  });

  it('throws GraphWriteError when the commit returns no record', async () => {
    const neo4j = {
      write: jest.fn(() => Promise.resolve([])),
    } as unknown as Neo4jService;
    const repo = new ServiceGraphRepository(neo4j);

    await expect(repo.commitServices(input)).rejects.toBeInstanceOf(
      GraphWriteError,
    );
  });

  describe('listCurrentForVendor', () => {
    // The query returns one aggregate record: { page, total, attributeSet }.
    function record(values: Record<string, unknown>) {
      return { get: (k: string) => values[k] };
    }

    it('returns empty without touching the graph for an unknown vendor', async () => {
      const read = jest.fn(() => Promise.resolve([]));
      const repo = new ServiceGraphRepository({
        read,
      } as unknown as Neo4jService);

      expect(
        await repo.listCurrentForVendor('org-1', undefined, {
          limit: 20,
          offset: 0,
        }),
      ).toEqual({ groupedServices: [], attributeSet: null, total: 0 });
      expect(read).not.toHaveBeenCalled();
    });

    it('groups services by canonical, unwraps Integer attributes, and returns total', async () => {
      const read = jest.fn(() =>
        Promise.resolve([
          record({
            total: { toNumber: () => 3 },
            attributeSet: 'quotation',
            page: [
              {
                canonicalName: 'local_haulage',
                canonicalDescription: 'Trucking.',
                category: 'Haulage',
                services: [
                  {
                    id: 'svc-1',
                    title: 'Local haulage - 20ft',
                    tier: '20ft',
                    tierSlug: '20ft',
                    pricingContext: 'per container',
                    canonicalName: 'local_haulage',
                    canonicalDescription: 'Trucking.',
                    category: 'Haulage',
                    validFrom: null,
                    validTo: null,
                    // price comes back as a wrapped Integer; others plain
                    attributes: {
                      price: { toNumber: () => 140 },
                      currency: 'SGD',
                      remarks: null,
                    },
                  },
                ],
              },
            ],
          }),
        ]),
      );
      const repo = new ServiceGraphRepository({
        read,
      } as unknown as Neo4jService);

      const result = await repo.listCurrentForVendor('org-1', 'vendor-1', {
        limit: 2,
        offset: 0,
      });
      expect(result).toEqual({
        groupedServices: [
          {
            canonicalName: 'local_haulage',
            canonicalDescription: 'Trucking.',
            category: 'Haulage',
            services: [
              {
                id: 'svc-1',
                title: 'Local haulage - 20ft',
                tier: '20ft',
                tierSlug: '20ft',
                pricingContext: 'per container',
                canonicalName: 'local_haulage',
                canonicalDescription: 'Trucking.',
                category: 'Haulage',
                model: 'Tiered',
                validFrom: null,
                validTo: null,
                attributes: { price: 140, currency: 'SGD', remarks: null },
              },
            ],
          },
        ],
        attributeSet: 'quotation',
        total: 3,
      });
    });

    it('filters by derived model and paginates the matches in-process', async () => {
      const group = (canonicalName: string, tier: string | null) => ({
        canonicalName,
        canonicalDescription: null,
        category: null,
        services: [
          {
            id: `svc-${canonicalName}`,
            title: canonicalName,
            tier,
            tierSlug: tier,
            pricingContext: 'per unit',
            canonicalName,
            canonicalDescription: null,
            category: null,
            validFrom: null,
            validTo: null,
            attributes: {},
          },
        ],
      });
      const read = jest.fn(() =>
        Promise.resolve([
          record({
            total: { toNumber: () => 3 },
            attributeSet: 'quotation',
            // two Flat groups + one Tiered group
            page: [group('a', null), group('b', '20ft'), group('c', null)],
          }),
        ]),
      );
      const repo = new ServiceGraphRepository({
        read,
      } as unknown as Neo4jService);

      const result = await repo.listCurrentForVendor('org-1', 'vendor-1', {
        limit: 1,
        offset: 1,
        model: 'Flat',
      });

      // model filter forces an unpaginated read, then slices in-process.
      expect(read).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ documentIds: null }),
      );
      expect(result.total).toBe(2); // two Flat groups matched
      expect(result.groupedServices).toHaveLength(1); // limit 1, offset 1
      expect(result.groupedServices[0].canonicalName).toBe('c');
      expect(result.groupedServices[0].services[0].model).toBe('Flat');
    });

    it('passes fileId documentIds through to the query', async () => {
      const read = jest.fn(() =>
        Promise.resolve([
          record({
            total: { toNumber: () => 0 },
            attributeSet: null,
            page: [],
          }),
        ]),
      );
      const repo = new ServiceGraphRepository({
        read,
      } as unknown as Neo4jService);

      await repo.listCurrentForVendor('org-1', 'vendor-1', {
        limit: 20,
        offset: 0,
        documentIds: ['doc-9'],
      });

      expect(read).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ documentIds: ['doc-9'] }),
      );
    });

    it('passes a trimmed q through, and null for blank/absent', async () => {
      const read = jest.fn(() =>
        Promise.resolve([
          record({
            total: { toNumber: () => 0 },
            attributeSet: null,
            page: [],
          }),
        ]),
      );
      const repo = new ServiceGraphRepository({
        read,
      } as unknown as Neo4jService);

      await repo.listCurrentForVendor('org-1', 'vendor-1', {
        limit: 20,
        offset: 0,
        q: '  haulage  ',
      });
      expect(read).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({ q: 'haulage' }),
      );

      await repo.listCurrentForVendor('org-1', 'vendor-1', {
        limit: 20,
        offset: 0,
        q: '   ',
      });
      expect(read).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({ q: null }),
      );

      await repo.listCurrentForVendor('org-1', 'vendor-1', {
        limit: 20,
        offset: 0,
      });
      expect(read).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({ q: null }),
      );
    });
  });

  describe('listServicesForCanonicals', () => {
    function record(values: Record<string, unknown>) {
      return { get: (k: string) => values[k] };
    }

    it('returns empty without touching the graph for an unknown vendor or no names', async () => {
      const read = jest.fn(() => Promise.resolve([]));
      const repo = new ServiceGraphRepository({
        read,
      } as unknown as Neo4jService);

      expect(
        await repo.listServicesForCanonicals('org-1', undefined, ['x']),
      ).toEqual([]);
      expect(
        await repo.listServicesForCanonicals('org-1', 'vendor-1', []),
      ).toEqual([]);
      expect(read).not.toHaveBeenCalled();
    });

    it('returns only the requested canonicals, scoped by vendor', async () => {
      const read = jest.fn(() =>
        Promise.resolve([
          record({
            groups: [
              {
                canonicalName: 'local_haulage',
                canonicalDescription: 'Trucking.',
                category: 'Haulage',
                services: [
                  {
                    id: 'svc-1',
                    title: 'Local haulage - 40ft',
                    tier: '40ft',
                    tierSlug: '40ft',
                    pricingContext: 'per container',
                    canonicalName: 'local_haulage',
                    canonicalDescription: 'Trucking.',
                    category: 'Haulage',
                    validFrom: null,
                    validTo: null,
                    attributes: { price: { toNumber: () => 220 } },
                  },
                ],
              },
            ],
          }),
        ]),
      );
      const repo = new ServiceGraphRepository({
        read,
      } as unknown as Neo4jService);

      const result = await repo.listServicesForCanonicals('org-1', 'vendor-1', [
        'local_haulage',
      ]);

      expect(read).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          vendorId: 'vendor-1',
          tenantId: 'org-1',
          canonicalNames: ['local_haulage'],
        }),
      );
      expect(result).toEqual([
        {
          canonicalName: 'local_haulage',
          canonicalDescription: 'Trucking.',
          category: 'Haulage',
          services: [
            {
              id: 'svc-1',
              title: 'Local haulage - 40ft',
              tier: '40ft',
              tierSlug: '40ft',
              pricingContext: 'per container',
              canonicalName: 'local_haulage',
              canonicalDescription: 'Trucking.',
              category: 'Haulage',
              model: 'Tiered',
              validFrom: null,
              validTo: null,
              attributes: { price: 220 },
            },
          ],
        },
      ]);
    });
  });
});
