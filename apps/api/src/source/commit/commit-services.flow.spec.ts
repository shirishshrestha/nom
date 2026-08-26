/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/unbound-method */
import { jest } from '@jest/globals';
import { DOCUMENT_STATUSES, STAGED_ORIGINS } from '@nom/shared';
import type { StagedService } from '@nom/shared';
import { ATTRIBUTE_SETS } from '../../attribute-set';
import { TEST_ORG_ID, TEST_SESSION } from '../../testing/test-constants';
import type { OrgSession } from '../../auth/auth.types';
import type { DocumentContextLoader } from '../../shared-loading/document-context.loader';
import type { StagingRepository } from '../staging/staging.repository';
import type { CanonicalMatcher } from '../extraction/canonical-matcher';
import type { ServiceReferenceDetector } from '../extraction/service-reference-detector';
import type { CanonicalRegistryRepository } from '../../infra/graph/canonical-registry.repository';
import type { ServiceGraphRepository } from '../../infra/graph/service-graph.repository';
import type { DocumentGraphRepository } from '../../infra/graph/document-graph.repository';
import { SourceCommitFlow } from './commit-services.flow';

const DOC_ID = '11111111-1111-1111-1111-111111111111';
const VENDOR_ID = '22222222-2222-2222-2222-222222222222';

const session = TEST_SESSION as OrgSession;
const asyncFn = () => jest.fn<(...args: any[]) => Promise<any>>();

function makeDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: DOC_ID,
    organizationId: TEST_ORG_ID,
    status: DOCUMENT_STATUSES.VALIDATED,
    attributeSet: 'quotation',
    fileId: 'file-1',
    vendorId: VENDOR_ID,
    documentType: 'source',
    effectiveFrom: undefined,
    effectiveTo: undefined,
    metadata: {},
    ...overrides,
  };
}

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

// A staged row as findLatestStaged would return it.
function makeRow(services: StagedService[]) {
  return {
    id: 'staging-prev',
    documentId: DOC_ID,
    fileId: 'file-1',
    fileName: 'rates.pdf',
    vendorId: VENDOR_ID,
    attributeSet: 'quotation',
    version: 1,
    services,
  };
}

function build() {
  const loader = {
    loadSourceDoc: asyncFn(),
  } as unknown as jest.Mocked<DocumentContextLoader>;
  (loader.loadSourceDoc as any).mockResolvedValue({
    document: makeDoc(),
    set: ATTRIBUTE_SETS.quotation,
  });

  const staging = {
    findLatestStaged: asyncFn(),
    stageExtraction: jest.fn((input: any) =>
      Promise.resolve({ ...input, id: 'staging-new', version: 2 }),
    ),
    markCommitted: jest.fn((row: any) =>
      Promise.resolve({
        ...row,
        status: 'committed',
        committedAt: new Date(),
      }),
    ),
  } as unknown as jest.Mocked<StagingRepository>;

  const canonicalMatcher = {
    match: asyncFn(),
  } as unknown as jest.Mocked<CanonicalMatcher>;
  // Default: matcher returns no changes (empty map).
  (canonicalMatcher.match as any).mockResolvedValue(new Map());

  const referenceDetector = {
    detect: asyncFn(),
  } as unknown as jest.Mocked<ServiceReferenceDetector>;
  // Default: no cross-service pricing references detected.
  (referenceDetector.detect as any).mockResolvedValue(new Map());

  const canonicalRegistry = {
    findForVendor: asyncFn(),
    tiersForVendor: asyncFn(),
  } as unknown as jest.Mocked<CanonicalRegistryRepository>;
  (canonicalRegistry.findForVendor as any).mockResolvedValue([]);
  (canonicalRegistry.tiersForVendor as any).mockResolvedValue([]);

  const serviceGraph = {
    commitServices: asyncFn(),
    amendServices: asyncFn(),
  } as unknown as jest.Mocked<ServiceGraphRepository>;
  (serviceGraph.commitServices as any).mockResolvedValue({
    canonicalCount: 1,
    serviceCount: 1,
  });
  (serviceGraph.amendServices as any).mockResolvedValue(1);

  const documentGraph = {
    upsertDocument: asyncFn(),
  } as unknown as jest.Mocked<DocumentGraphRepository>;
  (documentGraph.upsertDocument as any).mockResolvedValue(undefined);

  const rulesService = {
    rulesFor: asyncFn(),
    markRulesApplied: asyncFn(),
  } as any;
  rulesService.rulesFor.mockResolvedValue(undefined);
  rulesService.markRulesApplied.mockResolvedValue(undefined);

  const flow = new SourceCommitFlow(
    loader,
    staging,
    canonicalMatcher,
    referenceDetector,
    canonicalRegistry,
    serviceGraph,
    documentGraph,
    rulesService,
  );
  return {
    flow,
    loader,
    staging,
    canonicalMatcher,
    canonicalRegistry,
    serviceGraph,
    documentGraph,
  };
}

describe('SourceCommitFlow', () => {
  it('verifies all lines, re-versions on an edit (origin=save), and commits the new row', async () => {
    const { flow, canonicalMatcher, serviceGraph, staging } = build();
    const staged: StagedService = { ...makeStaged(), id: 'svc-1' };
    (staging.findLatestStaged as any).mockResolvedValue(makeRow([staged]));

    const res = await flow.run(session, DOC_ID, [
      { id: 'svc-1', attributes: { ...staged.attributes, price: 150 } },
    ]);

    // every line verified against the registry
    expect(canonicalMatcher.match).toHaveBeenCalledTimes(1);
    // an edit changed the set → a new origin=save version was staged
    expect(staging.stageExtraction).toHaveBeenCalledTimes(1);
    expect((staging.stageExtraction as any).mock.calls[0][0].origin).toBe(
      STAGED_ORIGINS.SAVE,
    );
    // the NEW row was committed (markCommitted flips both row + doc COMMITTED in one tx)
    const committed = (staging.markCommitted as any).mock.calls.at(-1)?.[0];
    expect(committed.id).toBe('staging-new');
    const graphInput = (serviceGraph.commitServices as any).mock.calls[0][0];
    expect(graphInput.rows[0].attributes.price).toBe(150);
    expect(res.status).toBe(DOCUMENT_STATUSES.COMMITTED);
    expect(res.version).toBe(2);
  });

  it('runEdit: re-issues an edited line under a new id and amends the prior graph node', async () => {
    const { flow, serviceGraph, staging } = build();
    const staged: StagedService = { ...makeStaged(), id: 'svc-1' };
    (staging.findLatestStaged as any).mockResolvedValue(makeRow([staged]));

    await flow.runEdit(session, DOC_ID, [
      { id: 'svc-1', attributes: { ...staged.attributes, price: 150 } },
    ]);

    // the graph committed the edit under a NEW id (not the original svc-1)
    const graphInput = (serviceGraph.commitServices as any).mock.calls[0][0];
    const newId = graphInput.rows[0].id;
    expect(newId).not.toBe('svc-1');
    expect(graphInput.rows[0].attributes.price).toBe(150);
    // and the prior node was retired + AMENDS-linked by (priorId → newId)
    const amendInput = (serviceGraph.amendServices as any).mock.calls[0][0];
    expect(amendInput.amendments).toEqual([{ priorId: 'svc-1', newId }]);
  });

  it('runEdit: a no-op edit amends nothing (no graph amend call)', async () => {
    const { flow, serviceGraph, staging } = build();
    const staged: StagedService = { ...makeStaged(), id: 'svc-1' };
    (staging.findLatestStaged as any).mockResolvedValue(makeRow([staged]));

    await flow.runEdit(session, DOC_ID, [
      { id: 'svc-1', attributes: { ...staged.attributes } },
    ]);

    expect(serviceGraph.amendServices).not.toHaveBeenCalled();
    // unchanged line keeps its id, commits in place (no new version)
    const graphInput = (serviceGraph.commitServices as any).mock.calls[0][0];
    expect(graphInput.rows[0].id).toBe('svc-1');
    expect(staging.stageExtraction).not.toHaveBeenCalled();
  });

  it('threads vendor rules (none in this test) into the matcher', async () => {
    const { flow, canonicalMatcher, staging } = build();
    (staging.findLatestStaged as any).mockResolvedValue(
      makeRow([{ ...makeStaged(), id: 'svc-1' }]),
    );

    await flow.run(session, DOC_ID, []);

    // trailing rules arg is wired through the reconcile step (no rules → undefined)
    const args = (canonicalMatcher.match as any).mock.calls[0];
    expect(args.at(-1)).toBeUndefined();
  });

  it('commits the latest row in place when nothing changed (no new version)', async () => {
    const { flow, staging } = build();
    const staged: StagedService = { ...makeStaged(), id: 'svc-1' };
    (staging.findLatestStaged as any).mockResolvedValue(makeRow([staged]));

    await flow.run(session, DOC_ID, []); // no edits, matcher returns no change

    expect(staging.stageExtraction).not.toHaveBeenCalled();
    const committed = (staging.markCommitted as any).mock.calls.at(-1)?.[0];
    expect(committed.id).toBe('staging-prev'); // latest, in place
  });

  it('does NOT re-version when only verification (no edit) changes a canonical; commits in place', async () => {
    const { flow, canonicalMatcher, serviceGraph, staging } = build();
    const staged: StagedService = { ...makeStaged(), id: 'svc-1' };
    (staging.findLatestStaged as any).mockResolvedValue(makeRow([staged]));
    (canonicalMatcher.match as any).mockResolvedValue(
      new Map([
        [
          'svc-1',
          {
            canonicalName: 'customs_handling',
            canonicalDescription: 'Clearing.',
            tierSlug: '0_10_teu',
          },
        ],
      ]),
    );

    await flow.run(session, DOC_ID, []); // no edits/deletions

    // No reviewer edits/deletions → no new staging version, even though the
    // system-side canonical shifted. The latest row commits in place...
    expect(staging.stageExtraction).not.toHaveBeenCalled();
    const committed = (staging.markCommitted as any).mock.calls.at(-1)?.[0];
    expect(committed.id).toBe('staging-prev');
    // ...and the reconciled canonical still reaches the graph.
    const graphInput = (serviceGraph.commitServices as any).mock.calls[0][0];
    expect(graphInput.rows[0].canonicalName).toBe('customs_handling');
  });

  it('collapses duplicate (canonicalName, tierSlug) lines before commit without re-versioning', async () => {
    const { flow, serviceGraph, staging } = build();
    // Two staged lines, same concept + same (null) band — would otherwise commit
    // as two concurrent current=true rows on one canonical.
    (staging.findLatestStaged as any).mockResolvedValue(
      makeRow([
        { ...makeStaged(), id: 'svc-1', tierSlug: null },
        { ...makeStaged(), id: 'svc-2', tierSlug: null },
      ]),
    );

    await flow.run(session, DOC_ID, []);

    // the graph receives ONE row (the duplicate was collapsed), keeping the last
    const graphInput = (serviceGraph.commitServices as any).mock.calls[0][0];
    expect(graphInput.rows).toHaveLength(1);
    expect(graphInput.rows[0].id).toBe('svc-2'); // last wins
    // no reviewer edits → the dedup commits the latest row in place, no new version
    expect(staging.stageExtraction).not.toHaveBeenCalled();
    const committed = (staging.markCommitted as any).mock.calls.at(-1)?.[0];
    expect(committed.id).toBe('staging-prev');
    expect(committed.services[0].log).toContain('merged duplicate of svc-1');
  });

  it('rejects a document with no vendor before reconciling (no LLM call)', async () => {
    const { flow, loader, canonicalMatcher, staging } = build();
    (loader.loadSourceDoc as any).mockResolvedValue({
      document: makeDoc({ vendorId: null }),
      set: ATTRIBUTE_SETS.quotation,
    });
    (staging.findLatestStaged as any).mockResolvedValue(
      makeRow([{ ...makeStaged(), id: 'svc-1' }]),
    );

    await expect(flow.run(session, DOC_ID, [])).rejects.toThrow(/no vendor/);
    // fail-fast: the guard fires at load, before the matcher burns an LLM call
    expect(canonicalMatcher.match).not.toHaveBeenCalled();
  });

  it('rejects an unknown service id', async () => {
    const { flow, staging } = build();
    (staging.findLatestStaged as any).mockResolvedValue(makeRow([]));
    await expect(
      flow.run(session, DOC_ID, [{ id: 'nope', attributes: {} }]),
    ).rejects.toThrow(/Unknown service id/);
  });

  it('drops deleted lines, re-versions (origin=save), and commits only the kept line', async () => {
    const { flow, serviceGraph, staging } = build();
    (staging.findLatestStaged as any).mockResolvedValue(
      makeRow([
        { ...makeStaged(), id: 'svc-1', tierSlug: 'a' },
        { ...makeStaged(), id: 'svc-2', tierSlug: 'b' },
      ]),
    );

    await flow.run(session, DOC_ID, [], ['svc-1']);

    // the deletion changed the set → a new origin=save version was staged w/o svc-1
    const restaged = (staging.stageExtraction as any).mock.calls[0][0];
    expect(restaged.origin).toBe(STAGED_ORIGINS.SAVE);
    expect(restaged.services).toHaveLength(1);
    expect(restaged.services[0].id).toBe('svc-2');
    // the graph commits only the kept line
    const graphInput = (serviceGraph.commitServices as any).mock.calls[0][0];
    expect(graphInput.rows).toHaveLength(1);
    expect(graphInput.rows[0].id).toBe('svc-2');
  });

  it('rejects a commit that deletes every line', async () => {
    const { flow, staging } = build();
    (staging.findLatestStaged as any).mockResolvedValue(
      makeRow([{ ...makeStaged(), id: 'svc-1' }]),
    );
    await expect(flow.run(session, DOC_ID, [], ['svc-1'])).rejects.toThrow(
      /empty service set/,
    );
  });

  it('rejects an unknown deleted service id', async () => {
    const { flow, staging } = build();
    (staging.findLatestStaged as any).mockResolvedValue(
      makeRow([{ ...makeStaged(), id: 'svc-1' }]),
    );
    await expect(flow.run(session, DOC_ID, [], ['nope'])).rejects.toThrow(
      /Unknown service id/,
    );
  });

  it("does NOT discard the vendor's other in-review docs", async () => {
    const { flow, staging } = build();
    (staging.findLatestStaged as any).mockResolvedValue(
      makeRow([{ ...makeStaged(), id: 'svc-1' }]),
    );

    await flow.run(session, DOC_ID, []);

    // only the committed doc's row is flipped (via markCommitted, which owns the
    // doc-status write in one tx); no bulk supersede of the vendor's other docs
    expect(staging.markCommitted).toHaveBeenCalledTimes(1);
    const committed = (staging.markCommitted as any).mock.calls[0][0];
    expect(committed.documentId ?? DOC_ID).toBe(DOC_ID);
  });
});
