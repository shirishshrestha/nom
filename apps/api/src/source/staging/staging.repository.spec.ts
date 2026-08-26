/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { jest } from '@jest/globals';
import { In } from 'typeorm';
import {
  DOCUMENT_STATUSES,
  STAGED_ORIGINS,
  STAGED_STATUSES,
} from '@nom/shared';
import { StagingRepository } from './staging.repository';

// Both live in-review statuses — a supersede must retire staged AND ready_to_commit rows.
const LIVE = In([STAGED_STATUSES.STAGED, STAGED_STATUSES.READY]);

function makeQueryBuilder(maxVersion: number | null) {
  // Fluent builder mock — each method returns `this` so chains work regardless of order.
  const builder: any = {
    withDeleted: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    distinctOn: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    getRawOne: jest.fn(() => Promise.resolve({ max: maxVersion })),
    getMany: jest.fn(() => Promise.resolve([])),
  };
  return builder;
}

function build(maxVersion: number | null = null) {
  const qb = makeQueryBuilder(maxVersion);
  // EntityManager handed to the stageExtraction transaction callback. nextVersion
  // (called both standalone and inside the tx) reads via createQueryBuilder.
  const m = {
    query: jest.fn<() => Promise<any>>().mockResolvedValue(undefined),
    update: jest.fn<() => Promise<any>>().mockResolvedValue(undefined),
    create: jest.fn((_entity: any, x: any) => x),
    save: jest.fn((x: any) => Promise.resolve({ ...x, id: 's1' })),
    createQueryBuilder: jest.fn(() => qb),
  } as any;
  const repo = {
    findOne: jest.fn(),
    find: jest.fn<() => Promise<any>>().mockResolvedValue([]),
    countBy: jest.fn<() => Promise<number>>().mockResolvedValue(0),
    create: jest.fn((x: any) => x),
    save: jest.fn((x: any) => Promise.resolve({ ...x, id: 's1' })),
    update: jest.fn<() => Promise<any>>().mockResolvedValue({ affected: 1 }),
    createQueryBuilder: jest.fn(() => qb),
    manager: {
      createQueryBuilder: jest.fn(() => qb),
      transaction: jest.fn((cb: any) => cb(m)),
    },
  } as any;
  return { repo, qb, m, sr: new StagingRepository(repo) };
}

const input = {
  organizationId: 'org-1',
  documentId: 'doc-1',
  fileId: 'file-1',
  fileName: 'rates.pdf',
  vendorId: 'vendor-1',
  attributeSet: 'quotation',
  services: [],
};

describe('StagingRepository', () => {
  it('nextVersion is 1 on an empty table', async () => {
    const { sr } = build(null);
    expect(await sr.nextVersion('org-1', 'doc-1')).toBe(1);
  });

  it('nextVersion increments the current max', async () => {
    const { sr } = build(2);
    expect(await sr.nextVersion('org-1', 'doc-1')).toBe(3);
  });

  it('nextVersion calls withDeleted so soft-deleted superseded rows count', async () => {
    const { sr, qb } = build(2);
    await sr.nextVersion('org-1', 'doc-1');
    expect(qb.withDeleted).toHaveBeenCalled();
  });

  it('stageExtraction supersedes prior staged rows then inserts at the next version', async () => {
    const { sr, m } = build(2);
    const row = await sr.stageExtraction(input);

    // prior live rows retired (via the transaction manager — entity, where, set)
    expect(m.update).toHaveBeenCalledWith(
      expect.anything(),
      {
        organizationId: 'org-1',
        documentId: 'doc-1',
        status: LIVE,
      },
      expect.objectContaining({
        status: STAGED_STATUSES.SUPERSEDED,
        deletedAt: expect.any(Date),
      }),
    );

    // m.create(Entity, fields) — the fields object is the second arg
    const created = m.create.mock.calls[0][1];
    expect(created.origin).toBe(STAGED_ORIGINS.EXTRACT);
    expect(created.status).toBe(STAGED_STATUSES.STAGED);
    expect(created.version).toBe(3);
    expect(row.id).toBe('s1');
  });

  it('re-extract over a live row supersedes staged AND ready_to_commit, inserts a fresh staged/extract version', async () => {
    const { sr, m } = build(3);
    await sr.stageExtraction(input);

    // the supersede-live update retires BOTH in-review statuses (so a READY doc drops
    // back out of review), keeping them as soft-deleted rows for the diff trail
    expect(m.update).toHaveBeenCalledWith(
      expect.anything(),
      { organizationId: 'org-1', documentId: 'doc-1', status: LIVE },
      expect.objectContaining({
        status: STAGED_STATUSES.SUPERSEDED,
        deletedAt: expect.any(Date),
      }),
    );
    // the new snapshot is un-reviewed machine output → staged/extract, next version
    const created = m.create.mock.calls[0][1];
    expect(created.status).toBe(STAGED_STATUSES.STAGED);
    expect(created.origin).toBe(STAGED_ORIGINS.EXTRACT);
    expect(created.version).toBe(4);
  });

  it('stageExtraction honours an explicit status (mark-ready READY snapshot)', async () => {
    const { sr, m } = build(3);
    await sr.stageExtraction({
      ...input,
      origin: STAGED_ORIGINS.SAVE,
      status: STAGED_STATUSES.READY,
    });
    const created = m.create.mock.calls[0][1];
    expect(created.status).toBe(STAGED_STATUSES.READY);
    expect(created.origin).toBe(STAGED_ORIGINS.SAVE);
  });

  describe('setReviewStatus', () => {
    it('flips the live row (guarded on `from`) and returns the updated row', async () => {
      const { sr, repo } = build(1);
      repo.findOne.mockResolvedValue({
        id: 's1',
        status: STAGED_STATUSES.READY,
        version: 3,
      });

      const row = await sr.setReviewStatus(
        'org-1',
        'doc-1',
        STAGED_STATUSES.STAGED,
        STAGED_STATUSES.READY,
      );

      expect(repo.update).toHaveBeenCalledWith(
        {
          organizationId: 'org-1',
          documentId: 'doc-1',
          status: STAGED_STATUSES.STAGED,
        },
        { status: STAGED_STATUSES.READY },
      );
      expect(row?.status).toBe(STAGED_STATUSES.READY);
    });

    it('returns null (no re-fetch) when no row was in the `from` state', async () => {
      const { sr, repo } = build(1);
      repo.update.mockResolvedValue({ affected: 0 });

      const row = await sr.setReviewStatus(
        'org-1',
        'doc-1',
        STAGED_STATUSES.READY,
        STAGED_STATUSES.STAGED,
      );

      expect(row).toBeNull();
      expect(repo.findOne).not.toHaveBeenCalled();
    });
  });

  describe('findLiveByIds', () => {
    it('returns [] without querying on an empty id list', async () => {
      const { sr, repo } = build(1);
      expect(await sr.findLiveByIds('org-1', [])).toEqual([]);
      expect(repo.find).not.toHaveBeenCalled();
    });

    it('resolves ids org-scoped (soft-deleted rows excluded by default)', async () => {
      const { sr, repo } = build(1);
      repo.find.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);

      const rows = await sr.findLiveByIds('org-1', ['a', 'b']);

      expect(repo.find).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', id: In(['a', 'b']) },
      });
      expect(rows).toHaveLength(2);
    });
  });

  it('markCommitted flips the row + owning doc COMMITTED in one transaction', async () => {
    const { sr, repo, m } = build(1);
    const result = await sr.markCommitted({
      id: 'x',
      documentId: 'doc-1',
      organizationId: 'org-1',
      status: STAGED_STATUSES.STAGED,
    } as any);
    // single transaction wraps both writes
    expect(repo.manager.transaction).toHaveBeenCalledTimes(1);
    // row saved committed + stamped
    expect(result.status).toBe(STAGED_STATUSES.COMMITTED);
    expect(m.save.mock.calls[0][0].committedAt).toBeInstanceOf(Date);
    expect(m.save.mock.calls[0][0].status).toBe(STAGED_STATUSES.COMMITTED);
    // owning document flipped COMMITTED in the same callback
    expect(m.update).toHaveBeenCalledWith(
      expect.anything(),
      { id: 'doc-1', organizationId: 'org-1' },
      { status: DOCUMENT_STATUSES.COMMITTED },
    );
  });

  it('isCommitted returns true when a committed row exists', async () => {
    const { sr, repo } = build(1);
    repo.countBy.mockResolvedValue(1);
    expect(await sr.isCommitted('org-1', 'doc-1')).toBe(true);
  });

  it('isCommitted returns false when no committed row exists', async () => {
    const { sr } = build(1);
    expect(await sr.isCommitted('org-1', 'doc-1')).toBe(false);
  });

  it('supersedeForDocuments bulk-retires staged rows for the given document ids', async () => {
    const { sr, repo } = build(1);
    const ids = ['doc-a', 'doc-b'];
    await sr.supersedeForDocuments('org-1', ids);
    expect(repo.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: LIVE }),
      expect.objectContaining({
        status: STAGED_STATUSES.SUPERSEDED,
        deletedAt: expect.any(Date),
      }),
    );
  });

  it('supersedeForDocuments is a no-op on an empty list', async () => {
    const { sr, repo } = build(1);
    await sr.supersedeForDocuments('org-1', []);
    expect(repo.update).not.toHaveBeenCalled();
  });
});
