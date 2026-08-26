/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { jest } from '@jest/globals';
import { DOCUMENT_STATUSES } from '@nom/shared';
import type { DocumentType } from '@nom/shared';
import { DocumentValidationFlow } from './document-validation.flow';
import { GraphWriteError } from '../infra/graph/graph-error';
import { TEST_ORG_ID, TEST_SESSION } from '../testing/test-constants';
import type { OrgSession } from '../auth/auth.types';

const SOURCE: DocumentType = 'source';
const session = TEST_SESSION as OrgSession;
const asyncFn = () => jest.fn<(...args: any[]) => Promise<any>>();

function build() {
  const documentsRepo = {
    findOneBy: asyncFn(),
    update: asyncFn(),
  } as any;
  documentsRepo.update.mockResolvedValue(undefined);

  const vendorMatcher = { match: asyncFn() } as any;
  vendorMatcher.match.mockResolvedValue(null);

  const documentGraph = { upsertDocument: asyncFn() } as any;
  documentGraph.upsertDocument.mockResolvedValue(undefined);

  const documentRepo = {
    findOldestDocumentForVendor: asyncFn(),
    findLatestDocumentForVendor: asyncFn(),
  } as any;
  documentRepo.findOldestDocumentForVendor.mockResolvedValue(null);
  documentRepo.findLatestDocumentForVendor.mockResolvedValue(null);

  const flow = new DocumentValidationFlow(
    documentsRepo,
    vendorMatcher,
    documentGraph,
    documentRepo,
  );
  return { flow, documentsRepo, vendorMatcher, documentGraph, documentRepo };
}

function validatableDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    organizationId: TEST_ORG_ID,
    vendorId: 'v1',
    documentType: SOURCE,
    attributeSet: 'quotation',
    status: DOCUMENT_STATUSES.VALIDATED,
    effectiveFrom: undefined,
    effectiveTo: undefined,
    metadata: {
      isFinancial: true,
      attributeSet: 'quotation',
      vendorName: 'Northstar',
    },
    ...overrides,
  };
}

describe('DocumentValidationFlow', () => {
  it('validate: tombstones a non-financial document with REJECTED', async () => {
    const { flow, documentsRepo, vendorMatcher, documentGraph } = build();
    const metadata = { isFinancial: false, attributeSet: undefined };
    documentsRepo.findOneBy.mockResolvedValue({
      ...validatableDoc(),
      metadata,
    });

    const res = await flow.validate(session, 'doc-1', SOURCE);

    expect(res.status).toBe(DOCUMENT_STATUSES.REJECTED);
    expect(res.warnings).toEqual([]);
    expect(res.rejectReason).toMatch(/valid quotation/i);
    expect(documentsRepo.update).toHaveBeenCalledWith(
      'doc-1',
      expect.objectContaining({
        status: DOCUMENT_STATUSES.REJECTED,
        rejectReason: expect.stringContaining('valid quotation'),
      }),
    );
    expect(documentsRepo.update.mock.calls[0][1]).not.toHaveProperty(
      'deletedAt',
    );
    expect(vendorMatcher.match).not.toHaveBeenCalled();
    expect(documentGraph.upsertDocument).not.toHaveBeenCalled();
  });

  it('validate: rejects a committed document', async () => {
    const { flow, documentsRepo } = build();
    documentsRepo.findOneBy.mockResolvedValue(
      validatableDoc({ status: DOCUMENT_STATUSES.COMMITTED }),
    );
    await expect(flow.validate(session, 'doc-1', SOURCE)).rejects.toThrow(
      /already committed/i,
    );
  });

  it('validate: re-validates a previously REJECTED document (not soft-deleted)', async () => {
    const { flow, documentsRepo } = build();
    documentsRepo.findOneBy.mockResolvedValue(
      validatableDoc({ status: DOCUMENT_STATUSES.REJECTED }),
    );

    const res = await flow.validate(session, 'doc-1', SOURCE);

    expect(res.status).toBe(DOCUMENT_STATUSES.VALIDATED);
  });

  it('validate: rejects when the vendor already has a document with a different attributeSet', async () => {
    const { flow, documentsRepo, documentRepo, vendorMatcher } = build();
    documentsRepo.findOneBy.mockResolvedValue(validatableDoc());
    documentRepo.findOldestDocumentForVendor.mockResolvedValue({
      attributeSet: 'insurance',
    });

    const res = await flow.validate(session, 'doc-1', SOURCE);

    expect(res.status).toBe(DOCUMENT_STATUSES.REJECTED);
    expect(res.rejectReason).toMatch(/same format/i);
    const [, payload] = documentsRepo.update.mock.calls[0];
    expect(payload).toEqual(
      expect.objectContaining({ status: DOCUMENT_STATUSES.REJECTED }),
    );
    expect(payload).not.toHaveProperty('deletedAt');
    expect(vendorMatcher.match).not.toHaveBeenCalled();
  });

  it('validate: rejects a source document dated older than the vendor latest', async () => {
    const { flow, documentsRepo, documentRepo, vendorMatcher } = build();
    documentsRepo.findOneBy.mockResolvedValue(
      validatableDoc({
        status: DOCUMENT_STATUSES.EXTRACTED,
        effectiveFrom: new Date('2026-03-01'),
      }),
    );
    documentRepo.findLatestDocumentForVendor.mockResolvedValue({
      effectiveFrom: new Date('2026-06-01'),
    });

    const res = await flow.validate(session, 'doc-1', SOURCE);

    expect(res.status).toBe(DOCUMENT_STATUSES.REJECTED);
    expect(res.rejectReason).toMatch(/newer .* already exists/i);
    expect(documentsRepo.update).toHaveBeenCalledWith(
      'doc-1',
      expect.objectContaining({ status: DOCUMENT_STATUSES.REJECTED }),
    );
    expect(vendorMatcher.match).not.toHaveBeenCalled();
  });

  it('validate: accepts a source document dated newer than the vendor latest', async () => {
    const { flow, documentsRepo, documentRepo } = build();
    documentsRepo.findOneBy.mockResolvedValue(
      validatableDoc({
        status: DOCUMENT_STATUSES.EXTRACTED,
        effectiveFrom: new Date('2026-03-01'),
      }),
    );
    documentRepo.findLatestDocumentForVendor.mockResolvedValue({
      effectiveFrom: new Date('2026-01-01'),
    });

    const res = await flow.validate(session, 'doc-1', SOURCE);

    expect(res.status).toBe(DOCUMENT_STATUSES.VALIDATED);
  });

  it('validate: records a vendor mismatch as a warning and mirrors to the graph', async () => {
    const { flow, documentsRepo, vendorMatcher, documentGraph } = build();
    documentsRepo.findOneBy.mockResolvedValue(validatableDoc());
    vendorMatcher.match.mockResolvedValue({
      isMatch: false,
      reason: 'different co',
    });

    const res = await flow.validate(session, 'doc-1', SOURCE);

    expect(res.status).toBe(DOCUMENT_STATUSES.VALIDATED);
    expect(res.warnings).toEqual(['different co']);
    expect(documentsRepo.update).toHaveBeenCalledWith(
      'doc-1',
      expect.objectContaining({ status: DOCUMENT_STATUSES.VALIDATED }),
    );
    expect(documentGraph.upsertDocument).toHaveBeenCalledTimes(1);
  });

  it('validate: a graph write failure is non-fatal', async () => {
    const { flow, documentsRepo, documentGraph } = build();
    documentsRepo.findOneBy.mockResolvedValue(validatableDoc());
    documentGraph.upsertDocument.mockRejectedValue(
      new GraphWriteError('neo4j down'),
    );

    const res = await flow.validate(session, 'doc-1', SOURCE);
    expect(res.status).toBe(DOCUMENT_STATUSES.VALIDATED);
  });
});
