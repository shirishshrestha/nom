/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { jest } from '@jest/globals';
import { OBSERVABILITY_ENTITY_TYPES } from '@nom/shared';
import { PipelineLogRepository } from './pipeline-log.repository';

// The repo is a thin scoped wrapper over a TypeORM repository, bound to one entity
// type at construction. These tests pin the two behaviours that matter: append is
// best-effort (never throws), and reads flatten per-entity in insertion order.
function build() {
  const insert = jest.fn<(...a: any[]) => Promise<any>>();
  insert.mockResolvedValue(undefined);
  const find = jest.fn<(...a: any[]) => Promise<any>>();
  find.mockResolvedValue([]);
  const repo = { insert, find } as any;
  return {
    repo,
    insert,
    find,
    sut: new PipelineLogRepository(repo, OBSERVABILITY_ENTITY_TYPES.LINE_ITEM),
  };
}

const ORG = 'org-1';

describe('PipelineLogRepository', () => {
  it('inserts one row per entity with non-empty messages, skipping empties', async () => {
    const { sut, insert } = build();
    await sut.append({
      organizationId: ORG,
      documentId: 'doc-1',
      entries: [
        { entityId: 'li-1', messages: ['a', 'b'] },
        { entityId: 'li-2', messages: [] }, // skipped
      ],
    });
    expect(insert).toHaveBeenCalledTimes(1);
    const rows = insert.mock.calls[0][0] as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organizationId: ORG,
      // stamped from the constructor-bound entity type, not the caller
      entityType: OBSERVABILITY_ENTITY_TYPES.LINE_ITEM,
      entityId: 'li-1',
      documentId: 'doc-1',
      messages: ['a', 'b'],
    });
  });

  it('does not insert when every entry is empty', async () => {
    const { sut, insert } = build();
    await sut.append({
      organizationId: ORG,
      documentId: 'doc-1',
      entries: [{ entityId: 'li-1', messages: [] }],
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it('swallows a failed write (observability is best-effort)', async () => {
    const { sut, insert } = build();
    insert.mockRejectedValue(new Error('db down'));
    await expect(
      sut.append({
        organizationId: ORG,
        documentId: 'doc-1',
        entries: [{ entityId: 'li-1', messages: ['x'] }],
      }),
    ).resolves.toBeUndefined();
  });

  it('flattens a single entity trail in row order, scoped to the bound entity type', async () => {
    const { sut, find } = build();
    find.mockResolvedValue([
      { entityId: 'li-1', messages: ['extracted'] },
      { entityId: 'li-1', messages: ['matched', 'reconciled'] },
    ]);
    const log = await sut.listForEntity(ORG, 'li-1');
    expect(log).toEqual(['extracted', 'matched', 'reconciled']);
    expect(find.mock.calls[0][0].where).toMatchObject({
      entityType: OBSERVABILITY_ENTITY_TYPES.LINE_ITEM,
    });
  });
});
