import { jest } from '@jest/globals';
import { CanonicalRegistryRepository } from './canonical-registry.repository';
import type { Neo4jService } from '@nom/neo4j';

function record(values: Record<string, unknown>) {
  return { get: (k: string) => values[k] };
}

describe('CanonicalRegistryRepository', () => {
  it('returns [] without touching the graph when vendor is unknown', async () => {
    const read = jest.fn(() => Promise.resolve([]));
    const repo = new CanonicalRegistryRepository({
      read,
    } as unknown as Neo4jService);

    expect(await repo.findForVendor('org-1', undefined)).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });

  it('maps canonical name + nullable description', async () => {
    const read = jest.fn(() =>
      Promise.resolve([
        record({ canonicalName: 'customs_clearance', description: 'clearing' }),
        record({ canonicalName: 'haulage', description: null }),
      ]),
    );
    const repo = new CanonicalRegistryRepository({
      read,
    } as unknown as Neo4jService);

    const entries = await repo.findForVendor('org-1', 'vendor-1');
    expect(entries).toEqual([
      { canonicalName: 'customs_clearance', description: 'clearing' },
      { canonicalName: 'haulage', description: null },
    ]);
  });

  describe('tiersForVendor', () => {
    it('returns [] without touching the graph when vendor is unknown', async () => {
      const read = jest.fn(() => Promise.resolve([]));
      const repo = new CanonicalRegistryRepository({
        read,
      } as unknown as Neo4jService);

      expect(await repo.tiersForVendor('org-1', undefined)).toEqual([]);
      expect(read).not.toHaveBeenCalled();
    });

    it('maps tierSlug + nullable label and pricingContext', async () => {
      const read = jest.fn(() =>
        Promise.resolve([
          record({
            canonicalName: 'empty_cartons_shipment_insurance',
            tierSlug: 'empty_cartons',
            label: 'Empty Cartons',
            pricingContext:
              'Ordinary risks including War (Waterborne) and SRCC risks. Rate is 0.05% of shipment value.',
          }),
          record({
            canonicalName: 'local_haulage',
            tierSlug: '20ft',
            label: null,
            pricingContext: null,
          }),
        ]),
      );
      const repo = new CanonicalRegistryRepository({
        read,
      } as unknown as Neo4jService);

      const entries = await repo.tiersForVendor('org-1', 'vendor-1');
      expect(entries).toEqual([
        {
          canonicalName: 'empty_cartons_shipment_insurance',
          tierSlug: 'empty_cartons',
          label: 'Empty Cartons',
          pricingContext:
            'Ordinary risks including War (Waterborne) and SRCC risks. Rate is 0.05% of shipment value.',
          attributes: null,
        },
        {
          canonicalName: 'local_haulage',
          tierSlug: '20ft',
          label: null,
          pricingContext: null,
          attributes: null,
        },
      ]);
    });
  });

  describe('searchCanonicals', () => {
    it('returns [] without touching the graph when the query has nothing searchable', async () => {
      const read = jest.fn(() => Promise.resolve([]));
      const repo = new CanonicalRegistryRepository({
        read,
      } as unknown as Neo4jService);

      expect(
        await repo.searchCanonicals('org-1', 'vendor-1', '   ', 5),
      ).toEqual([]);
      expect(read).not.toHaveBeenCalled();
    });

    it('strips Lucene special characters before searching and returns ranked names', async () => {
      const read =
        jest.fn<
          (
            cypher: string,
            params?: Record<string, unknown>,
          ) => Promise<unknown[]>
        >();
      read.mockResolvedValue([
        record({ canonicalName: 'ocean_freight' }),
        record({ canonicalName: 'ocean_freight_fcl' }),
      ]);
      const repo = new CanonicalRegistryRepository({
        read,
      } as unknown as Neo4jService);

      const result = await repo.searchCanonicals(
        'org-1',
        'vendor-1',
        'Ocean Freight (FCL) - 40ft:',
        5,
      );

      expect(result).toEqual(['ocean_freight', 'ocean_freight_fcl']);
      const [, params] = read.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect(params.vendorId).toBe('vendor-1');
      expect(params.tenantId).toBe('org-1');
      expect(params.query).not.toMatch(/[()\-:]/);
      expect(params.query).toContain('Ocean');
      expect(params.query).toContain('40ft');
    });
  });
});
