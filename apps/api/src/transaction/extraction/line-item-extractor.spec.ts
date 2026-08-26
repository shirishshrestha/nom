import { ContentEntity } from '@nom/database';
import type { DocumentMetadata } from '@nom/shared';
import { ATTRIBUTE_SETS } from '../../attribute-set';
import { FakeStructuredExtractor } from '../../infra/llm/fake.structured-extractor';
import type { CanonicalRegistryEntry } from '../../infra/graph/canonical-registry.repository';
import { LineItemExtractor } from './line-item-extractor';

// LineItemExtractor turns each invoice chunk into billed line items and assigns the
// first-pass match guess. The FakeStructuredExtractor returns already schema-shaped
// output, so these tests exercise the mapping + audit-log logic, not the LLM.

const set = ATTRIBUTE_SETS.invoice;
const registry: CanonicalRegistryEntry[] = [
  { canonicalName: 'local_haulage', description: null },
];
const meta: DocumentMetadata = { isFinancial: false, attributeSet: null };

function chunk(over: Partial<ContentEntity> = {}): ContentEntity {
  return {
    id: 'chunk-1',
    organizationId: 'org-1',
    documentId: 'doc-1',
    label: 'Invoice A',
    text: 'body text',
    position: 3,
    ...over,
  } as ContentEntity;
}

// One well-formed extracted line the model would return under buildLineItemSchema.
function extracted(over: Record<string, unknown> = {}) {
  return {
    description: 'Truck 1x40 FCL',
    foundAt: 'line 1',
    sourceText: '1 Truck 1x40 FCL 220.00',
    attributes: { quantity: 1, amount: 220, currency: 'SGD' },
    initialKind: 'service_match',
    initialCanonical: 'Local Haulage',
    initialTierSlug: '40ft',
    initialRefSummary: null,
    taxable: true,
    taxPercentage: 9,
    formula: 'rate * quantity',
    symbols: [
      { name: 'rate', value: null },
      { name: 'quantity', value: 1 },
    ],
    ...over,
  };
}

function build(perChunk: unknown) {
  const fake = new FakeStructuredExtractor(() => perChunk);
  return { fake, extractor: new LineItemExtractor(fake) };
}

describe('LineItemExtractor', () => {
  it('maps an extracted line to a LineItem with normalized initial match', async () => {
    const { extractor } = build({ lineItems: [extracted()] });
    const [item] = await extractor.extract(set, [chunk()], registry, [], meta);

    expect(item.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(item.invoiceRef).toBe('Invoice A');
    expect(item.sectionLabel).toBe('Invoice A');
    expect(item.initialKind).toBe('service_match');
    expect(item.initialCanonical).toBe('local_haulage'); // normalized
    expect(item.initialTierSlug).toBe('40ft');
    expect(item.taxable).toBe(true);
    expect(item.taxPercentage).toBe(9);
    // symbols: array-of-{name,value} → keyed object.
    expect(item.symbols).toEqual({ rate: null, quantity: 1 });
    expect(item.meta).toEqual({
      foundAt: 'line 1',
      sourceText: '1 Truck 1x40 FCL 220.00',
      contentId: 'chunk-1',
      position: 3,
      sectionContext: null,
    });
  });

  it('fans the chunk-level sectionContext onto every line of that chunk', async () => {
    const { extractor } = build({
      lineItems: [extracted(), extracted({ description: 'Second line' })],
      sectionContext: 'Bill Period: Balance Stock (Feb 2025)',
    });
    const items = await extractor.extract(set, [chunk()], registry, [], meta);

    expect(items).toHaveLength(2);
    for (const it of items)
      expect(it.meta.sectionContext).toBe(
        'Bill Period: Balance Stock (Feb 2025)',
      );
  });

  it('builds the audit log: provenance header, extraction entry, formula, validation', async () => {
    const { extractor } = build({ lineItems: [extracted()] });
    const [item] = await extractor.extract(set, [chunk()], registry, [], meta);

    expect(item.log).toHaveLength(3);
    expect(item.log[0]).toContain('origin · doc=doc-1 · chunk=chunk-1');
    expect(item.log[0]).toContain('invoice=Invoice A · pos=3');
    expect(item.log[1]).toContain(
      'initial guess: bills rate-card service "local_haulage" (tier "40ft")',
    );
    expect(item.log[2]).toContain(
      'Captured formula "rate * quantity" — well-formed.',
    );
  });

  it('defaults taxPercentage to 0 and leaves an empty canonical null', async () => {
    const { extractor } = build({
      lineItems: [
        extracted({
          initialKind: 'unmatched',
          initialCanonical: null,
          initialTierSlug: null,
          taxPercentage: null,
        }),
      ],
    });
    const [item] = await extractor.extract(set, [chunk()], registry, [], meta);

    expect(item.taxPercentage).toBe(0);
    expect(item.initialCanonical).toBeNull();
    expect(item.initialTierSlug).toBeNull();
  });

  it('sends one request per chunk with the chunk label + text in the human turn', async () => {
    const { fake, extractor } = build({ lineItems: [] });
    await extractor.extract(
      set,
      [
        chunk({ label: 'A', text: 'aaa' }),
        chunk({ id: 'c2', label: 'B', text: 'bbb' }),
      ],
      registry,
      [],
      meta,
    );

    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0].human).toBe('## A\n\naaa');
    expect(fake.calls[1].human).toBe('## B\n\nbbb');
    expect(typeof fake.calls[0].system).toBe('string');
    // reference threaded per chunk for fine-tuning log capture (content-scoped)
    expect(fake.calls[1].options?.reference).toEqual({
      organizationId: 'org-1',
      sourceType: 'content',
      sourceId: 'c2',
    });
  });

  it('renders the document-context block into the system prompt when metadata is present', async () => {
    const { fake, extractor } = build({ lineItems: [] });
    await extractor.extract(set, [chunk()], registry, [], {
      isFinancial: true,
      attributeSet: 'invoice',
      summary: 'March freight billing for ACME',
      currency: 'SGD',
    });

    const system = fake.calls[0].system;
    expect(system).toContain(
      'Document context (the whole document this chunk belongs to):',
    );
    expect(system).toContain('Overview: March freight billing for ACME');
  });
});
