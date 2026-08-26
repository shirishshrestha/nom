import { ATTRIBUTE_SETS } from '../../attribute-set';
import { FakeStructuredExtractor } from '../../infra/llm/fake.structured-extractor';
import {
  ServiceReferenceDetector,
  type ReferenceDetectLine,
} from './service-reference-detector';
import type { ServiceReferenceResult } from '../service-schema';

// The detector identifies cross-service pricing references across a document's reconciled
// lines and drops any that point at an unknown or own canonical (fail-soft). Driven with a
// FakeStructuredExtractor returning canned references.

const set = ATTRIBUTE_SETS.quotation;

const lines: ReferenceDetectLine[] = [
  {
    id: 'a',
    canonicalName: 'customs_clearance',
    title: 'Customs clearance',
    pricingContext: '1% of total value',
  },
  {
    id: 'b',
    canonicalName: 'documentation_handling',
    title: 'Documentation handling',
    pricingContext: '40% of customs clearance',
  },
];

function build(result: ServiceReferenceResult) {
  const fake = new FakeStructuredExtractor(() => result);
  return { fake, detector: new ServiceReferenceDetector(fake) };
}

describe('ServiceReferenceDetector', () => {
  it('maps a valid cross-service reference by its from-line id', async () => {
    const { detector } = build({
      references: [
        {
          fromId: 'b',
          referencedCanonical: 'customs_clearance',
          referencedTierSlug: null,
          relation: '40% of customs clearance',
        },
      ],
    });

    const refs = await detector.detect(set, lines, 'org', 'doc');

    expect(refs.get('b')).toEqual({
      referencedCanonical: 'customs_clearance',
      referencedTierSlug: null,
      relation: '40% of customs clearance',
    });
  });

  it('drops a reference to a canonical not present in the document', async () => {
    const { detector } = build({
      references: [
        {
          fromId: 'b',
          referencedCanonical: 'nonexistent_service',
          referencedTierSlug: null,
          relation: '40% of a service that is not here',
        },
      ],
    });

    const refs = await detector.detect(set, lines, 'org', 'doc');
    expect(refs.size).toBe(0);
  });

  it('drops a self-reference (a line pointing at its own canonical)', async () => {
    const { detector } = build({
      references: [
        {
          fromId: 'a',
          referencedCanonical: 'customs_clearance',
          referencedTierSlug: null,
          relation: 'same as above',
        },
      ],
    });

    const refs = await detector.detect(set, lines, 'org', 'doc');
    expect(refs.size).toBe(0);
  });

  it('does not call the LLM when fewer than two services exist', async () => {
    const { fake, detector } = build({ references: [] });
    const refs = await detector.detect(set, [lines[0]], 'org', 'doc');

    expect(refs.size).toBe(0);
    expect(fake.calls).toHaveLength(0);
  });
});
