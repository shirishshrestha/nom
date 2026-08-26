/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/unbound-method */
import { jest } from '@jest/globals';
import { In } from 'typeorm';
import {
  DOCUMENT_STATUSES,
  STAGED_ORIGINS,
  STAGED_STATUSES,
} from '@nom/shared';
import type { StagedService } from '@nom/shared';
import { SourceService } from './source.service';
import { ATTRIBUTE_SETS } from '../attribute-set';
import { TEST_ORG_ID, TEST_SESSION } from '../testing/test-constants';
import type { OrgSession } from '../auth/auth.types';
import type { StagingRepository } from './staging/staging.repository';
import type { SourceExtractFlow } from './extraction/extract-services.flow';
import type { SourceCommitFlow } from './commit/commit-services.flow';

const DOC_ID = '11111111-1111-1111-1111-111111111111';
const VENDOR_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_DOC_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

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
  const documentsRepo = {
    update: asyncFn(),
    find: asyncFn(),
    findOne: asyncFn(),
  } as any;
  documentsRepo.update.mockResolvedValue(undefined);
  documentsRepo.find.mockResolvedValue([]); // no stale vendor docs by default
  documentsRepo.findOne.mockResolvedValue(null);

  const contentRepo = { findOneBy: asyncFn() } as any;
  contentRepo.findOneBy.mockResolvedValue(null);

  const staging = {
    latestUncommittedForVendor: asyncFn(),
    latestUncommittedForOrg: asyncFn(),
    supersedeForDocuments: asyncFn(),
    findLatestStaged: asyncFn(),
    setReviewStatus: asyncFn(),
    stageExtraction: asyncFn(),
    findLiveByIds: asyncFn(),
  } as unknown as jest.Mocked<StagingRepository>;
  (staging.latestUncommittedForVendor as any).mockResolvedValue([]);
  (staging.latestUncommittedForOrg as any).mockResolvedValue([]);
  (staging.supersedeForDocuments as any).mockResolvedValue(undefined);

  const attributeSets = {
    get: jest.fn((k: string) => ATTRIBUTE_SETS[k]),
  } as any;

  const extractFlow = {
    run: asyncFn(),
  } as unknown as jest.Mocked<SourceExtractFlow>;
  (extractFlow.run as any).mockResolvedValue({ documentId: DOC_ID });

  const commitFlow = {
    run: asyncFn(),
  } as unknown as jest.Mocked<SourceCommitFlow>;
  (commitFlow.run as any).mockResolvedValue({
    documentId: DOC_ID,
    status: DOCUMENT_STATUSES.COMMITTED,
  });

  const service = new SourceService(
    documentsRepo,
    contentRepo,
    staging,
    attributeSets,
    extractFlow,
    commitFlow,
  );
  return {
    service,
    documentsRepo,
    contentRepo,
    staging,
    attributeSets,
    extractFlow,
    commitFlow,
  };
}

describe('SourceService', () => {
  describe('extractServices', () => {
    it('delegates to the extract flow and returns its result', async () => {
      const { service, extractFlow } = build();
      const res = await service.extractServices(session, DOC_ID);
      expect(extractFlow.run).toHaveBeenCalledWith(session, DOC_ID);
      expect(res).toEqual({ documentId: DOC_ID });
    });
  });

  describe('saveStagedServices', () => {
    it('delegates to the commit flow and returns its result', async () => {
      const { service, commitFlow } = build();
      const edits = [{ id: 'svc-1', attributes: {} }];
      const res = await service.saveStagedServices(session, DOC_ID, edits, [
        'svc-2',
      ]);
      expect(commitFlow.run).toHaveBeenCalledWith(session, DOC_ID, edits, [
        'svc-2',
      ]);
      expect(res).toEqual({
        documentId: DOC_ID,
        status: DOCUMENT_STATUSES.COMMITTED,
      });
    });

    it('defaults deletedServiceIds to an empty array', async () => {
      const { service, commitFlow } = build();
      await service.saveStagedServices(session, DOC_ID, []);
      expect(commitFlow.run).toHaveBeenCalledWith(session, DOC_ID, [], []);
    });
  });

  const makeRow = (over: Partial<any> = {}) => ({
    id: 'row-1',
    documentId: DOC_ID,
    fileId: 'f1',
    fileName: 'rates.pdf',
    vendorId: VENDOR_ID,
    attributeSet: 'quotation',
    version: 3,
    status: STAGED_STATUSES.STAGED,
    services: [makeStaged()],
    ...over,
  });

  describe('markReady', () => {
    it('with no edits flips the live row to ready in place — no new version', async () => {
      const { service, staging } = build();
      (staging.findLatestStaged as any).mockResolvedValue(makeRow());
      (staging.setReviewStatus as any).mockResolvedValue(
        makeRow({ status: STAGED_STATUSES.READY }),
      );

      const res = await service.markReady(session, DOC_ID, []);

      expect(staging.stageExtraction).not.toHaveBeenCalled();
      expect(staging.setReviewStatus).toHaveBeenCalledWith(
        TEST_ORG_ID,
        DOC_ID,
        STAGED_STATUSES.STAGED,
        STAGED_STATUSES.READY,
      );
      expect(res).toEqual({
        documentId: DOC_ID,
        version: 3,
        reviewStatus: STAGED_STATUSES.READY,
      });
    });

    it('with edits persists a READY save snapshot (new version), not an in-place flip', async () => {
      const { service, staging } = build();
      (staging.findLatestStaged as any).mockResolvedValue(makeRow());
      (staging.stageExtraction as any).mockResolvedValue(
        makeRow({ version: 4, status: STAGED_STATUSES.READY }),
      );

      const res = await service.markReady(session, DOC_ID, [
        { id: 'svc-extracted', attributes: { price: 999 } },
      ]);

      expect(staging.setReviewStatus).not.toHaveBeenCalled();
      expect(staging.stageExtraction).toHaveBeenCalledWith(
        expect.objectContaining({
          origin: STAGED_ORIGINS.SAVE,
          status: STAGED_STATUSES.READY,
        }),
      );
      expect(res.version).toBe(4);
      expect(res.reviewStatus).toBe(STAGED_STATUSES.READY);
    });

    it('throws when there is no staged row to mark', async () => {
      const { service, staging } = build();
      (staging.findLatestStaged as any).mockResolvedValue(null);
      await expect(service.markReady(session, DOC_ID, [])).rejects.toThrow(
        /run extract first/i,
      );
    });
  });

  describe('unmarkReady', () => {
    it('flips ready_to_commit back to staged', async () => {
      const { service, staging } = build();
      (staging.setReviewStatus as any).mockResolvedValue(
        makeRow({ status: STAGED_STATUSES.STAGED }),
      );

      const res = await service.unmarkReady(session, DOC_ID);

      expect(staging.setReviewStatus).toHaveBeenCalledWith(
        TEST_ORG_ID,
        DOC_ID,
        STAGED_STATUSES.READY,
        STAGED_STATUSES.STAGED,
      );
      expect(res.reviewStatus).toBe(STAGED_STATUSES.STAGED);
    });

    it('throws when the document is not marked ready', async () => {
      const { service, staging } = build();
      (staging.setReviewStatus as any).mockResolvedValue(null);
      await expect(service.unmarkReady(session, DOC_ID)).rejects.toThrow(
        /not marked ready/i,
      );
    });
  });

  describe('commitAll', () => {
    const S1 = 's1';
    const S2 = 's2';
    const S3 = 's3';
    const S4 = 's4';
    const OTHER_VENDOR_ID = '33333333-3333-3333-3333-333333333333';

    it('commits only ready rows of this vendor and reports the rest', async () => {
      const { service, staging, commitFlow } = build();
      (staging.findLiveByIds as any).mockResolvedValue([
        {
          id: S1,
          documentId: DOC_ID,
          vendorId: VENDOR_ID,
          status: STAGED_STATUSES.READY,
        },
        {
          id: S2,
          documentId: OTHER_DOC_ID,
          vendorId: VENDOR_ID,
          status: STAGED_STATUSES.STAGED,
        },
        {
          id: S3,
          documentId: 'd3',
          vendorId: OTHER_VENDOR_ID,
          status: STAGED_STATUSES.READY,
        },
      ]);
      (commitFlow.run as any).mockResolvedValue({
        documentId: DOC_ID,
        version: 5,
        serviceCount: 2,
        canonicalCount: 1,
        status: DOCUMENT_STATUSES.COMMITTED,
      });

      const res = await service.commitAll(session, VENDOR_ID, [S1, S2, S3, S4]);

      expect(commitFlow.run).toHaveBeenCalledTimes(1);
      expect(commitFlow.run).toHaveBeenCalledWith(session, DOC_ID, [], []);
      expect(res.committed).toEqual([
        {
          stagedId: S1,
          documentId: DOC_ID,
          version: 5,
          serviceCount: 2,
          canonicalCount: 1,
        },
      ]);
      const reasons = Object.fromEntries(
        res.failed.map((f) => [f.stagedId, f.reason]),
      );
      expect(reasons[S2]).toMatch(/not ready/i);
      expect(reasons[S3]).toMatch(/different vendor/i);
      expect(reasons[S4]).toMatch(/unknown/i);
    });

    it("one doc's commit failure does not abort the batch", async () => {
      const { service, staging, commitFlow } = build();
      (staging.findLiveByIds as any).mockResolvedValue([
        {
          id: S1,
          documentId: DOC_ID,
          vendorId: VENDOR_ID,
          status: STAGED_STATUSES.READY,
        },
        {
          id: S2,
          documentId: OTHER_DOC_ID,
          vendorId: VENDOR_ID,
          status: STAGED_STATUSES.READY,
        },
      ]);
      (commitFlow.run as any).mockImplementation((_s: any, docId: string) =>
        docId === DOC_ID
          ? Promise.reject(new Error('graph write failed'))
          : Promise.resolve({
              documentId: OTHER_DOC_ID,
              version: 2,
              serviceCount: 1,
              canonicalCount: 1,
              status: DOCUMENT_STATUSES.COMMITTED,
            }),
      );

      const res = await service.commitAll(session, VENDOR_ID, [S1, S2]);

      expect(res.committed.map((c) => c.stagedId)).toEqual([S2]);
      expect(res.failed).toEqual([
        { stagedId: S1, reason: 'graph write failed' },
      ]);
    });
  });

  describe('listUncommittedForVendor', () => {
    it('feeds VALIDATED + STAGED docs: STAGED with services, VALIDATED with empty services', async () => {
      const { service, documentsRepo, staging } = build();
      documentsRepo.find.mockResolvedValue([
        {
          id: DOC_ID,
          status: DOCUMENT_STATUSES.STAGED,
          file: { name: 'rates.pdf' },
        },
        {
          id: OTHER_DOC_ID,
          status: DOCUMENT_STATUSES.VALIDATED,
          file: { name: 'new.pdf' },
        },
      ]);
      (staging.latestUncommittedForVendor as any).mockResolvedValue([
        { documentId: DOC_ID, services: [makeStaged()] },
      ]);

      const res = await service.listUncommittedForVendor(
        TEST_ORG_ID,
        VENDOR_ID,
      );

      // Pin the feed filter: only VALIDATED + STAGED reach the review page — a
      // validated doc must appear (empty services) so the advancer stages it.
      expect(documentsRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: In([DOCUMENT_STATUSES.VALIDATED, DOCUMENT_STATUSES.STAGED]),
          }),
        }),
      );

      const stagedDoc = res.documents.find((d) => d.documentId === DOC_ID)!;
      const validatedDoc = res.documents.find(
        (d) => d.documentId === OTHER_DOC_ID,
      )!;
      expect(stagedDoc.status).toBe(DOCUMENT_STATUSES.STAGED);
      expect(stagedDoc.services).toHaveLength(1);
      // not-yet-staged docs → empty services → client drives the next action from status
      expect(validatedDoc.status).toBe(DOCUMENT_STATUSES.VALIDATED);
      expect(validatedDoc.services).toHaveLength(0);
    });
  });

  describe('findLatestUncommittedDocument', () => {
    const OTHER_VENDOR_ID = '33333333-3333-3333-3333-333333333333';

    it('picks the doc with the newest recency = max(doc.updatedAt, staged.createdAt)', async () => {
      const { service, documentsRepo, staging } = build();
      // Doc A: newer updatedAt, but NOT staged. Doc B: older updatedAt, yet its
      // staged row was created most recently → B wins on the max() rule (staging a
      // new version doesn't bump the doc's updatedAt, so createdAt is what counts).
      documentsRepo.find.mockResolvedValue([
        {
          id: DOC_ID,
          vendorId: VENDOR_ID,
          status: DOCUMENT_STATUSES.VALIDATED,
          updatedAt: new Date('2026-06-20T00:00:00.000Z'),
          file: { name: 'a.pdf' },
          metadata: {},
        },
        {
          id: OTHER_DOC_ID,
          vendorId: OTHER_VENDOR_ID,
          status: DOCUMENT_STATUSES.STAGED,
          updatedAt: new Date('2026-06-10T00:00:00.000Z'),
          file: { name: 'b.pdf' },
          metadata: {},
        },
      ]);
      (staging.latestUncommittedForOrg as any).mockResolvedValue([
        {
          documentId: OTHER_DOC_ID,
          createdAt: new Date('2026-06-25T00:00:00.000Z'),
          services: [makeStaged()],
        },
      ]);

      const res = await service.findLatestUncommittedDocument(TEST_ORG_ID);

      // The staged doc wins on max(updatedAt, staged.createdAt) despite its older
      // updatedAt, and its staged services come through.
      expect(res.document?.documentId).toBe(OTHER_DOC_ID);
      expect(res.vendorId).toBe(OTHER_VENDOR_ID);
      expect(res.document?.services).toHaveLength(1);
    });

    it('returns nulls when the org has nothing uncommitted', async () => {
      const { service, documentsRepo } = build();
      documentsRepo.find.mockResolvedValue([]);

      const res = await service.findLatestUncommittedDocument(TEST_ORG_ID);

      expect(res).toEqual({
        document: null,
        vendorId: null,
        attributeSet: null,
      });
    });
  });

  describe('discardUncommittedForVendor', () => {
    it('retires staged rows and soft-deletes the vendor uncommitted docs', async () => {
      const { service, documentsRepo, staging } = build();
      documentsRepo.find.mockResolvedValue([
        { id: DOC_ID },
        { id: OTHER_DOC_ID },
      ]);

      const res = await service.discardUncommittedForVendor(
        TEST_ORG_ID,
        VENDOR_ID,
      );

      expect(res.documentIds).toEqual([DOC_ID, OTHER_DOC_ID]);
      expect(res.status).toBe(DOCUMENT_STATUSES.DISCARDED);
      expect(staging.supersedeForDocuments).toHaveBeenCalledWith(TEST_ORG_ID, [
        DOC_ID,
        OTHER_DOC_ID,
      ]);
      expect(documentsRepo.update).toHaveBeenCalledWith(
        { id: In([DOC_ID, OTHER_DOC_ID]), organizationId: TEST_ORG_ID },
        expect.objectContaining({
          status: DOCUMENT_STATUSES.DISCARDED,
          deletedAt: expect.any(Date),
        }),
      );
    });

    it('is a no-op when the vendor has nothing in review', async () => {
      const { service, documentsRepo, staging } = build();
      documentsRepo.find.mockResolvedValue([]);

      const res = await service.discardUncommittedForVendor(
        TEST_ORG_ID,
        VENDOR_ID,
      );

      expect(res.documentIds).toEqual([]);
      expect(staging.supersedeForDocuments).not.toHaveBeenCalled();
      expect(documentsRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('getContentChunk', () => {
    it('returns the chunk when found', async () => {
      const { service, contentRepo, documentsRepo } = build();
      contentRepo.findOneBy.mockResolvedValue({
        id: 'c1',
        documentId: 'd1',
        label: 'Storage',
        text: 'Ambient storage — S$X per pallet',
        position: 2,
        metadata: { page: 3 },
      });
      documentsRepo.findOne.mockResolvedValue({
        fileId: 'f1',
        file: { name: 'rates.pdf' },
        metadata: { pageCount: 5 },
      });

      const chunk = await service.getContentChunk(TEST_ORG_ID, 'c1');

      expect(chunk).toEqual({
        id: 'c1',
        label: 'Storage',
        text: 'Ambient storage — S$X per pallet',
        position: 2,
        fileName: 'rates.pdf',
        page: 3,
        totalPages: 5,
      });
      expect(contentRepo.findOneBy).toHaveBeenCalledWith({
        id: 'c1',
        organizationId: TEST_ORG_ID,
      });
    });

    it('throws NotFound when the chunk is missing', async () => {
      const { service, contentRepo } = build();
      contentRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.getContentChunk(TEST_ORG_ID, 'missing'),
      ).rejects.toThrow(/not found/i);
    });
  });
});
