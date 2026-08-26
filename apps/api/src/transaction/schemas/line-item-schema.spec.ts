import type { CanonicalServiceGroup } from '../../infra/graph/service-graph.repository';
import { renderRateCardCluster } from './line-item-schema';

// renderRateCardCluster dumps a committed service's attribute bag inline for the resolver.
// The bag comes from properties(a), which carries the Attributes node's plumbing keys
// (serviceId/tenantId/attributeSet) alongside real rate attributes — those must be stripped.
describe('renderRateCardCluster', () => {
  const group = {
    canonicalName: 'pallet_handling_charge',
    canonicalDescription: null,
    category: null,
    services: [
      {
        id: 'svc-1',
        canonicalName: 'pallet_handling_charge',
        canonicalDescription: null,
        category: null,
        title: 'Handling charge',
        tier: null,
        tierSlug: null,
        pricingContext: 'Once-off charge per incoming pallet.',
        attributes: {
          serviceId: 'svc-1',
          tenantId: 'org-1',
          attributeSet: 'invoice',
          price: 6,
          currency: 'SGD',
          unit: 'per pallet',
        },
        validFrom: null,
        validTo: null,
      },
    ],
  } as unknown as CanonicalServiceGroup;

  it('renders real rate attributes but drops the internal plumbing keys', () => {
    const out = renderRateCardCluster([group]);

    expect(out).toContain('price=6');
    expect(out).toContain('unit=per pallet');
    expect(out).not.toContain('serviceId=');
    expect(out).not.toContain('tenantId=');
    expect(out).not.toContain('attributeSet=');
  });
});
