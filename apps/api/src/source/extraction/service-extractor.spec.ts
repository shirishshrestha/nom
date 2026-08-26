import { ContentEntity } from '@nom/database';
import { ServiceExtractor } from './service-extractor';
import { ATTRIBUTE_SETS } from '../../attribute-set';
import { FakeStructuredExtractor } from '../../infra/llm/fake.structured-extractor';
import type { ExtractionRequest } from '../../infra/llm/structured-extractor.port';

const set = ATTRIBUTE_SETS.quotation;
const META = { isFinancial: true, attributeSet: 'quotation' };

function chunk(id: string, label: string, text: string): ContentEntity {
  return {
    id,
    organizationId: 'org-1',
    label,
    text,
    position: 0,
  } as ContentEntity;
}

function svc(
  canonicalName: string,
  title: string,
  tier: string | null = null,
  tierSlug: string | null = null,
) {
  return {
    title,
    canonicalName,
    canonicalDescription: `${canonicalName} desc`,
    category: null,
    tier,
    tierSlug,
    pricingContext: 'ctx',
    foundAt: null,
    sourceText: title,
    attributes: { price: 1, currency: 'SGD', unit: 'per x', remarks: null },
  };
}

describe('ServiceExtractor', () => {
  it('assembles staged services with provenance from each chunk', async () => {
    const fake = new FakeStructuredExtractor(() => ({
      services: [svc('customs_clearance', 'Customs clearance')],
    }));
    const extractor = new ServiceExtractor(fake);

    const services = await extractor.extract(
      set,
      [chunk('c1', 'Origin charges', 'Customs clearance ...')],
      [],
      [],
      META,
    );

    expect(services).toHaveLength(1);
    expect(services[0].canonicalName).toBe('customs_clearance');
    expect(services[0].tierSlug).toBeNull();
    expect(services[0].meta.contentId).toBe('c1');
    expect(services[0].id).toMatch(/[0-9a-f-]{36}/);
    // reference threaded for fine-tuning log capture (content-scoped)
    expect(fake.calls[0].options?.reference).toEqual({
      organizationId: 'org-1',
      sourceType: 'content',
      sourceId: 'c1',
    });
  });

  it('drops the transient nameBasis scratch field from staged services', async () => {
    const fake = new FakeStructuredExtractor(() => ({
      services: [
        {
          ...svc('customs_clearance', 'Customs clearance'),
          nameBasis: 'concept=customs clearance; axis=none; grain=none',
        },
      ],
    }));
    const services = await new ServiceExtractor(fake).extract(
      set,
      [chunk('c1', 'A', 'x')],
      [],
      [],
      META,
    );
    expect('nameBasis' in services[0]).toBe(false);
  });

  it('fans the chunk-level sectionContext onto every line of that chunk', async () => {
    const fake = new FakeStructuredExtractor(() => ({
      services: [
        svc('customs_clearance', 'Customs clearance'),
        svc('documentation', 'Documentation fee'),
      ],
      sectionContext: 'Bill Period: Balance Stock (Feb 2025)',
    }));
    const extractor = new ServiceExtractor(fake);

    const services = await extractor.extract(
      set,
      [chunk('c1', 'Charges', 'two lines ...')],
      [],
      [],
      META,
    );

    expect(services).toHaveLength(2);
    for (const s of services)
      expect(s.meta.sectionContext).toBe(
        'Bill Period: Balance Stock (Feb 2025)',
      );
  });

  it('defaults sectionContext to null when the chunk has none', async () => {
    const fake = new FakeStructuredExtractor(() => ({
      services: [svc('customs_clearance', 'Customs clearance')],
      // no sectionContext key
    }));
    const services = await new ServiceExtractor(fake).extract(
      set,
      [chunk('c1', 'A', 'x')],
      [],
      [],
      META,
    );
    expect(services[0].meta.sectionContext).toBeNull();
  });

  it('normalizes the tier slug and feeds minted slugs into later chunks', async () => {
    const prompts: string[] = [];
    const fake = new FakeStructuredExtractor(
      (req: ExtractionRequest<unknown>) => {
        prompts.push(req.system);
        // Raw, differently-spelled band labels that normalize to one slug.
        return prompts.length === 1
          ? { services: [svc('local_haulage', '20ft', '20 FT', '20 FT')] }
          : { services: [svc('local_haulage', '40ft', '40ft', '40ft')] };
      },
    );
    const extractor = new ServiceExtractor(fake);

    const services = await extractor.extract(
      set,
      [chunk('c1', 'A', 'first'), chunk('c2', 'B', 'second')],
      [],
      [],
      META,
    );

    expect(services[0].tierSlug).toBe('20_ft');
    // Second chunk's prompt lists the slug minted while processing the first.
    expect(prompts[1]).toContain('20_ft');
  });

  it('feeds canonicals minted in earlier chunks into later chunk prompts', async () => {
    const prompts: string[] = [];
    // Sentinel name that never appears in prompt boilerplate, so a hit means feed-forward.
    const minted = 'zzz_sentinel_concept';
    const fake = new FakeStructuredExtractor(
      (req: ExtractionRequest<unknown>) => {
        prompts.push(req.system);
        return prompts.length === 1
          ? { services: [svc(minted, 'Haulage')] }
          : { services: [svc(minted, 'Haulage tier 2')] };
      },
    );
    const extractor = new ServiceExtractor(fake);

    await extractor.extract(
      set,
      [chunk('c1', 'A', 'first'), chunk('c2', 'B', 'second')],
      [],
      [],
      META,
    );

    // Second chunk's prompt lists the canonical minted while processing the first.
    expect(prompts[0]).not.toContain(minted);
    expect(prompts[1]).toContain(minted);
  });

  it('injects the document-context block into every chunk prompt', async () => {
    const prompts: string[] = [];
    const fake = new FakeStructuredExtractor(
      (req: ExtractionRequest<unknown>) => {
        prompts.push(req.system);
        return { services: [] };
      },
    );

    await new ServiceExtractor(fake).extract(
      set,
      [chunk('c1', 'A', 'x'), chunk('c2', 'B', 'y')],
      [],
      [],
      {
        isFinancial: true,
        attributeSet: 'quotation',
        summary: 'Ocean freight rate card, 3 lanes.',
        currency: 'USD',
        validFrom: '2026-01-01',
        validTo: '2026-06-30',
      },
    );

    for (const p of prompts) {
      expect(p).toContain('Document context');
      expect(p).toContain('Ocean freight rate card, 3 lanes.');
      expect(p).toContain('USD');
      expect(p).toContain('2026-01-01 → 2026-06-30');
    }
  });
});
