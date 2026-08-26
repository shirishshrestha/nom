/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { jest } from '@jest/globals';
import { Between, Not } from 'typeorm';
import { DOCUMENT_STATUSES } from '@nom/shared';
import type { DocumentType } from '@nom/shared';
import { DocumentsService } from './documents.service';
import { TEST_SESSION } from '../testing/test-constants';
import type { OrgSession } from '../auth/auth.types';

const SOURCE: DocumentType = 'source';
const session = TEST_SESSION as OrgSession;
const asyncFn = () => jest.fn<(...args: any[]) => Promise<any>>();

function build() {
  const documentsRepo = {
    findBy: asyncFn(),
    create: jest.fn((x: any) => x),
    save: jest.fn((x: any) =>
      Promise.resolve({
        ...x,
        id: 'doc-1',
        status: x.status ?? DOCUMENT_STATUSES.EXTRACTED,
      }),
    ),
    findOneBy: asyncFn(),
    find: asyncFn(),
    findAndCount: asyncFn(),
    update: asyncFn(),
  } as any;
  documentsRepo.findBy.mockResolvedValue([]); // no committed docs by default
  documentsRepo.find.mockResolvedValue([]);
  documentsRepo.findAndCount.mockResolvedValue([[], 0]);
  documentsRepo.update.mockResolvedValue(undefined);

  const contentRepo = {
    create: jest.fn((x: any) => x),
    save: asyncFn(),
  } as any;
  contentRepo.save.mockResolvedValue(undefined);

  const filesRepo = { findBy: asyncFn() } as any;
  filesRepo.findBy.mockResolvedValue([
    {
      id: 'file-1',
      vendorId: 'v1',
      createdAt: new Date(),
      mimeType: 'application/pdf',
      sizeBytes: 12345,
      documentType: SOURCE,
    },
  ]);

  const documentExtractor = { extractMany: asyncFn() } as any;
  documentExtractor.extractMany.mockResolvedValue([
    {
      ok: true,
      file: { id: 'file-1', vendorId: 'v1', documentType: SOURCE },
      document: {
        metadata: {
          isFinancial: true,
          attributeSet: 'quotation',
          vendorName: 'X',
        },
        sections: [{ label: 'Origin charges', text: 'Customs ...' }],
      },
    },
  ]);

  const rulesService = {
    rulesFor: asyncFn(),
    markRulesApplied: asyncFn(),
  } as any;
  rulesService.rulesFor.mockResolvedValue(undefined);
  rulesService.markRulesApplied.mockResolvedValue(undefined);

  const validationFlow = { validate: asyncFn() } as any;
  validationFlow.validate.mockResolvedValue(undefined);

  const service = new DocumentsService(
    documentsRepo,
    contentRepo,
    filesRepo,
    documentExtractor,
    rulesService,
    validationFlow,
  );
  return {
    service,
    documentsRepo,
    contentRepo,
    filesRepo,
    documentExtractor,
    validationFlow,
  };
}

describe('DocumentsService', () => {
  it('extract: persists a document row + content chunks per file', async () => {
    const { service, documentsRepo, contentRepo, documentExtractor } = build();
    const res = await service.extractMetadata(session, ['file-1']);

    expect(res).toHaveLength(1);
    expect(res[0].documentId).toBe('doc-1');
    expect(res[0].status).toBe(DOCUMENT_STATUSES.EXTRACTED);
    expect(documentExtractor.extractMany).toHaveBeenCalledTimes(1);
    expect(documentsRepo.save).toHaveBeenCalledTimes(1);
    expect(contentRepo.save).toHaveBeenCalledTimes(1);
  });

  it('extract: supersedes prior live documents for the same file', async () => {
    const { service, documentsRepo } = build();
    await service.extractMetadata(session, ['file-1']);

    // persist calls update to retire prior live docs
    expect(documentsRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: 'file-1', documentType: SOURCE }),
      expect.objectContaining({
        status: DOCUMENT_STATUSES.SUPERSEDED,
        deletedAt: expect.any(Date),
      }),
    );
  });

  it('extract: isolates a failed file as a REJECTED row without sinking the batch', async () => {
    const { service, documentsRepo, documentExtractor } = build();
    documentExtractor.extractMany.mockResolvedValue([
      {
        ok: false,
        file: { id: 'file-1', documentType: SOURCE },
        error: 'document too large',
      },
    ]);

    const res = await service.extractMetadata(session, ['file-1']);

    expect(res).toHaveLength(1);
    expect(res[0].status).toBe(DOCUMENT_STATUSES.REJECTED);
    expect(documentsRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: DOCUMENT_STATUSES.REJECTED,
        rejectReason: 'document too large',
      }),
    );
    expect(documentsRepo.create.mock.calls[0][0]).not.toHaveProperty(
      'deletedAt',
    );
  });

  it('extract: throws when a requested file is missing', async () => {
    const { service, filesRepo } = build();
    filesRepo.findBy.mockResolvedValue([]);
    await expect(service.extractMetadata(session, ['file-1'])).rejects.toThrow(
      /not found/i,
    );
  });

  it('extract: throws if any file already has a committed document', async () => {
    const { service, documentsRepo } = build();
    documentsRepo.findBy.mockResolvedValue([
      { fileId: 'file-1', status: DOCUMENT_STATUSES.COMMITTED },
    ]);
    await expect(service.extractMetadata(session, ['file-1'])).rejects.toThrow(
      /committed/i,
    );
    // LLM extractor not called
  });

  it('listDocuments: excludes REJECTED documents by default', async () => {
    const { service, documentsRepo } = build();

    await service.listDocuments(session, SOURCE);

    expect(documentsRepo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: Not(DOCUMENT_STATUSES.REJECTED),
        }),
      }),
    );
  });

  it('listDocuments: builds status/vendor/date-range filters', async () => {
    const { service, documentsRepo } = build();

    await service.listDocuments(session, SOURCE, {
      status: DOCUMENT_STATUSES.VALIDATED,
      vendorId: 'v1',
      dateFrom: '2026-06-01',
      dateTo: '2026-06-30',
    });

    expect(documentsRepo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: DOCUMENT_STATUSES.VALIDATED,
          vendorId: 'v1',
          effectiveFrom: Between(
            new Date('2026-06-01'),
            new Date('2026-06-30'),
          ),
        }),
      }),
    );
  });

  it('listDocuments: paginates with skip/take and echoes totalCount/page/limit', async () => {
    const { service, documentsRepo } = build();
    documentsRepo.findAndCount.mockResolvedValue([[], 42]);

    const res = await service.listDocuments(session, SOURCE, {
      page: 2,
      limit: 10,
    });

    expect(documentsRepo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10 }),
    );
    expect(res).toMatchObject({ totalCount: 42, page: 2, limit: 10 });
  });

  it('listDocuments: strips internal metadata + maps vendorName', async () => {
    const { service, documentsRepo } = build();
    documentsRepo.findAndCount.mockResolvedValue([
      [
        {
          id: 'doc-1',
          fileId: 'file-1',
          status: DOCUMENT_STATUSES.VALIDATED,
          vendorId: 'v1',
          vendor: { name: 'Acme Freight' },
          attributeSet: 'quotation',
          effectiveFrom: new Date('2026-06-01'),
          createdAt: new Date('2026-05-01'),
          updatedAt: new Date('2026-05-02'),
          metadata: {
            isFinancial: true,
            attributeSet: 'quotation',
            total: 100,
            log: { vendorName: 'seen on p1' },
            validation: { vendorMatch: { isMatch: true, reason: 'why' } },
            typeMismatchReason: 'nope',
          },
        },
      ],
      1,
    ]);

    const res = await service.listDocuments(session, SOURCE);
    const row = res.documents[0];

    expect(row.vendorName).toBe('Acme Freight');
    expect(row.amountKeys).toEqual(['price']);
    expect(row.fileSizeBytes).toBe(12345);
    expect(row.createdAt).toBe(new Date('2026-05-01').toISOString());
    expect(row.updatedAt).toBe(new Date('2026-05-02').toISOString());
    expect(row.metadata).toMatchObject({ isFinancial: true, total: 100 });
    expect(row.metadata).not.toHaveProperty('log');
    expect(row.metadata).not.toHaveProperty('validation');
    expect(row.metadata).not.toHaveProperty('typeMismatchReason');
  });

  it('discardDocument: soft-deletes an uncommitted document', async () => {
    const { service, documentsRepo } = build();
    documentsRepo.findOneBy.mockResolvedValue({
      id: 'doc-1',
      status: DOCUMENT_STATUSES.VALIDATED,
    });

    const res = await service.discardDocument(session, 'doc-1', SOURCE);

    expect(res.status).toBe(DOCUMENT_STATUSES.DISCARDED);
    expect(documentsRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'doc-1' }),
      expect.objectContaining({
        status: DOCUMENT_STATUSES.DISCARDED,
        deletedAt: expect.any(Date),
      }),
    );
  });

  it('discardDocument: rejects deleting a committed document', async () => {
    const { service, documentsRepo } = build();
    documentsRepo.findOneBy.mockResolvedValue({
      id: 'doc-1',
      status: DOCUMENT_STATUSES.COMMITTED,
    });

    await expect(
      service.discardDocument(session, 'doc-1', SOURCE),
    ).rejects.toThrow(/committed/i);
    expect(documentsRepo.update).not.toHaveBeenCalled();
  });

  it('discardDocument: 404s when the document is absent', async () => {
    const { service, documentsRepo } = build();
    documentsRepo.findOneBy.mockResolvedValue(null);

    await expect(
      service.discardDocument(session, 'missing', SOURCE),
    ).rejects.toThrow(/not found/i);
  });

  it('listDocuments: derives reviewStatus from reviewCompleted', async () => {
    const { service, documentsRepo } = build();
    const base = {
      fileId: 'file-1',
      vendorId: 'v1',
      attributeSet: 'quotation',
      effectiveFrom: new Date('2026-06-01'),
      createdAt: new Date('2026-05-01'),
      updatedAt: new Date('2026-05-02'),
      metadata: { isFinancial: true },
    };
    documentsRepo.findAndCount.mockResolvedValue([
      [
        {
          ...base,
          id: 'a',
          status: DOCUMENT_STATUSES.MATCHING,
          reviewCompleted: false,
        },
        {
          ...base,
          id: 'b',
          status: DOCUMENT_STATUSES.MATCHED,
          reviewCompleted: true,
        },
        {
          ...base,
          id: 'c',
          status: DOCUMENT_STATUSES.VALIDATED,
          reviewCompleted: false,
        },
        {
          ...base,
          id: 'd',
          status: DOCUMENT_STATUSES.MATCHING,
          reviewCompleted: true,
        },
      ],
      4,
    ]);

    const rows = (await service.listDocuments(session, SOURCE)).documents;

    expect(rows.map((r) => r.reviewStatus)).toEqual([
      'Pending', // reviewCompleted is the only signal now
      'Completed',
      'Pending',
      'Completed',
    ]);
  });

  it('setReviewCompleted: flips the flag and recomputes reviewStatus', async () => {
    const { service, documentsRepo } = build();
    documentsRepo.findOneBy.mockResolvedValue({
      id: 'doc-1',
      status: DOCUMENT_STATUSES.MATCHED,
    });

    const marked = await service.setReviewCompleted(
      session,
      'doc-1',
      'transaction',
      true,
    );
    expect(marked).toMatchObject({
      documentId: 'doc-1',
      reviewCompleted: true,
      reviewStatus: 'Completed',
    });
    expect(documentsRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'doc-1' }),
      { reviewCompleted: true },
    );

    const unmarked = await service.setReviewCompleted(
      session,
      'doc-1',
      'transaction',
      false,
    );
    expect(unmarked.reviewStatus).toBe('Pending');
  });

  it('setReviewCompleted: 404s when the document is absent', async () => {
    const { service, documentsRepo } = build();
    documentsRepo.findOneBy.mockResolvedValue(null);

    await expect(
      service.setReviewCompleted(session, 'missing', 'transaction', true),
    ).rejects.toThrow(/not found/i);
  });
});
