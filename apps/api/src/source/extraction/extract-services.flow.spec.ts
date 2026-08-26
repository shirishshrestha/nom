/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { jest } from '@jest/globals';
import { DOCUMENT_STATUSES } from '@nom/shared';
import type { StagedService } from '@nom/shared';
import { ATTRIBUTE_SETS } from '../../attribute-set';
import { TEST_ORG_ID, TEST_SESSION } from '../../testing/test-constants';
import type { OrgSession } from '../../auth/auth.types';
import type { DocumentContextLoader } from '../../shared-loading/document-context.loader';
import type { StagingRepository } from '../staging/staging.repository';
import type { ServiceExtractor } from './service-extractor';
import type { CanonicalRegistryRepository } from '../../infra/graph/canonical-registry.repository';
import { SourceExtractFlow } from './extract-services.flow';

const DOC_ID = '11111111-1111-1111-1111-111111111111';
const VENDOR_ID = '22222222-2222-2222-2222-222222222222';

const session = TEST_SESSION as OrgSession;
const asyncFn = () => jest.fn<(...args: any[]) => Promise<any>>();

function makeStaged(): StagedService {
  return {
    id: 'svc-extracted',
    canonicalName: 'customs_clearance',
    canonicalDescription: 'Clearing cargo.',
    title: 'Customs clearance',
    category: 'customs',
    tier: '0-10 TEU',
    tierSlug: '0_10_teu',
    pricingContext: 'per container',
    pricingRef: null,
    attributes: {
      price: 140,
      currency: 'SGD',
      unit: 'per container',
      remarks: null,
    },
    meta: {
      foundAt: 'page 1',
      sourceText: 'Customs clearance — S$140 per container',
      contentId: 'c1',
      sectionLabel: 'Origin charges',
      position: 0,
      sectionContext: null,
    },
    log: 'extracted by gemini · page 1',
  };
}

function build() {
  const document = {
    id: DOC_ID,
    organizationId: TEST_ORG_ID,
    vendorId: VENDOR_ID,
    fileId: 'file-1',
    metadata: { isFinancial: true, attributeSet: 'quotation', currency: 'SGD' },
  };

  const documentsRepo = { update: asyncFn() } as any;
  documentsRepo.update.mockResolvedValue(undefined);

  const loader = {
    loadSourceContext: asyncFn(),
  } as unknown as jest.Mocked<DocumentContextLoader>;
  (loader.loadSourceContext as any).mockResolvedValue({
    document,
    set: ATTRIBUTE_SETS.quotation,
    sections: [
      {
        id: 'c1',
        label: 'Origin charges',
        text: 'Customs clearance ...',
        position: 0,
      },
    ],
    file: { name: 'rates.pdf' },
  });

  const staging = {
    isCommitted: asyncFn(),
    stageExtraction: jest.fn((input: any) =>
      Promise.resolve({ ...input, id: 'staging-new', version: 2 }),
    ),
  } as unknown as jest.Mocked<StagingRepository>;
  (staging.isCommitted as any).mockResolvedValue(false);

  const extractor = {
    extract: asyncFn(),
  } as unknown as jest.Mocked<ServiceExtractor>;
  (extractor.extract as any).mockResolvedValue([makeStaged()]);

  const canonicalRegistry = {
    findForVendor: asyncFn(),
    tiersForVendor: asyncFn(),
  } as unknown as jest.Mocked<CanonicalRegistryRepository>;
  (canonicalRegistry.findForVendor as any).mockResolvedValue([]);
  (canonicalRegistry.tiersForVendor as any).mockResolvedValue([]);

  const rulesService = {
    rulesFor: asyncFn(),
    markRulesApplied: asyncFn(),
  } as any;
  rulesService.rulesFor.mockResolvedValue(undefined);
  rulesService.markRulesApplied.mockResolvedValue(undefined);

  const flow = new SourceExtractFlow(
    documentsRepo,
    loader,
    staging,
    extractor,
    canonicalRegistry,
    rulesService,
  );
  return { flow, documentsRepo, loader, staging, extractor, canonicalRegistry };
}

describe('SourceExtractFlow', () => {
  it('stages services, strips canonical fields, and moves the doc to STAGED', async () => {
    const { flow, staging, documentsRepo } = build();
    const res = await flow.run(session, DOC_ID);

    expect(res.services).toHaveLength(1);
    expect(res.services[0]).not.toHaveProperty('canonicalDescription');
    expect(res.services[0]).not.toHaveProperty('tierSlug');
    const input = (staging.stageExtraction as any).mock.calls[0][0];
    expect(input.services[0].canonicalName).toBe('customs_clearance');
    expect(documentsRepo.update).toHaveBeenCalledWith(
      { id: DOC_ID, organizationId: TEST_ORG_ID },
      { status: DOCUMENT_STATUSES.STAGED },
    );
    expect(res.version).toBe(2);
    expect(res.fileName).toBe('rates.pdf');
  });

  it('threads document metadata into the extractor call', async () => {
    const { flow, extractor } = build();
    await flow.run(session, DOC_ID);
    const args = (extractor.extract as any).mock.calls[0];
    // extract(set, sections, registry, tiers, metadata, guidance)
    expect(args[4]).toMatchObject({ currency: 'SGD' });
  });

  it('propagates loader gating (non-validated document)', async () => {
    const { flow, loader } = build();
    (loader.loadSourceContext as any).mockRejectedValue(
      new Error('Document must be validated before extracting services'),
    );
    await expect(flow.run(session, DOC_ID)).rejects.toThrow(/validated/);
  });

  it('throws if the document is already committed', async () => {
    const { flow, staging } = build();
    (staging.isCommitted as any).mockResolvedValue(true);
    await expect(flow.run(session, DOC_ID)).rejects.toThrow(
      /already committed/,
    );
  });
});
