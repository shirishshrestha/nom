import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { DocumentEntity, StagedServiceExtractionEntity } from '@nom/database';
import {
  DOCUMENT_STATUSES,
  STAGED_ORIGINS,
  STAGED_STATUSES,
  type StagedOrigin,
  type StagedService,
  type StagedStatus,
} from '@nom/shared';
import { stripNuls } from '../../common/text';

// The two live (in-review) statuses: a document's single active staged row is either
// `staged` or `ready_to_commit`. Every "is this the live row?" filter uses this so a
// re-extract / discard supersedes a READY row too (never leaving two live rows).
const LIVE_STAGED_STATUSES: StagedStatus[] = [
  STAGED_STATUSES.STAGED,
  STAGED_STATUSES.READY,
];

export interface StageExtractionInput {
  organizationId: string;
  documentId: string;
  fileId: string;
  fileName: string;
  vendorId?: string;
  attributeSet: string;
  services: StagedService[];
  // Defaults to EXTRACT (machine extraction); SAVE marks a human-reviewed snapshot.
  origin?: StagedOrigin;
  // Defaults to STAGED; READY marks a reviewer-parked snapshot (mark-ready with edits).
  status?: StagedStatus;
}

@Injectable()
export class StagingRepository {
  private readonly logger = new Logger(StagingRepository.name);

  constructor(
    @InjectRepository(StagedServiceExtractionEntity)
    private readonly repo: Repository<StagedServiceExtractionEntity>,
  ) {}

  findLatestStaged(
    organizationId: string,
    documentId: string,
  ): Promise<StagedServiceExtractionEntity | null> {
    return this.repo.findOne({
      where: { organizationId, documentId },
      order: { version: 'DESC' },
    });
  }

  /**
   * A vendor's source docs whose LATEST staged snapshot is still in review, for
   * rehydrating the review editor. DISTINCT ON picks the highest version per
   * document (soft-deleted superseded rows excluded by default); the status
   * filter drops docs already committed.
   */
  latestUncommittedForVendor(
    organizationId: string,
    vendorId: string,
  ): Promise<StagedServiceExtractionEntity[]> {
    return this.latestUncommitted(organizationId, vendorId);
  }

  /**
   * Org-wide variant of latestUncommittedForVendor (no vendor filter), backing the
   * global "latest uncommitted" lookup. Same DISTINCT ON highest-version-per-doc +
   * still-in-review filter.
   */
  latestUncommittedForOrg(
    organizationId: string,
  ): Promise<StagedServiceExtractionEntity[]> {
    return this.latestUncommitted(organizationId);
  }

  private async latestUncommitted(
    organizationId: string,
    vendorId?: string,
  ): Promise<StagedServiceExtractionEntity[]> {
    const qb = this.repo
      .createQueryBuilder('s')
      .distinctOn(['s.documentId'])
      .where('s.organizationId = :organizationId', { organizationId });
    if (vendorId) qb.andWhere('s.vendorId = :vendorId', { vendorId });
    const rows = await qb
      .orderBy('s.documentId')
      .addOrderBy('s.version', 'DESC')
      .getMany();
    return rows.filter((r) => LIVE_STAGED_STATUSES.includes(r.status));
  }

  /** Includes soft-deleted rows so version numbers stay monotonic across supersessions. */
  async nextVersion(
    organizationId: string,
    documentId: string,
  ): Promise<number> {
    return this.nextVersionWithin(
      this.repo.manager,
      organizationId,
      documentId,
    );
  }

  private async nextVersionWithin(
    manager: EntityManager,
    organizationId: string,
    documentId: string,
  ): Promise<number> {
    const row = await manager
      .createQueryBuilder(StagedServiceExtractionEntity, 's')
      .withDeleted()
      .select('MAX(s.version)', 'max')
      .where('s.organizationId = :organizationId', { organizationId })
      .andWhere('s.documentId = :documentId', { documentId })
      .getRawOne<{ max: number | null }>();
    return (row?.max ?? 0) + 1;
  }

  /**
   * Wrapped in a transaction with a per-document advisory lock: concurrent
   * extract/save for the same document can't both read the same MAX(version) and
   * leave two live STAGED rows. (A partial unique index on (organizationId,
   * documentId) WHERE status='staged' is the DB-level belt - generate when infra is up.)
   */
  async stageExtraction(
    input: StageExtractionInput,
  ): Promise<StagedServiceExtractionEntity> {
    return this.repo.manager.transaction(async (manager) => {
      // Serialize per document; auto-released at tx end.
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${input.organizationId}:${input.documentId}`,
      ]);

      const now = new Date();
      await manager.update(
        StagedServiceExtractionEntity,
        {
          organizationId: input.organizationId,
          documentId: input.documentId,
          status: In(LIVE_STAGED_STATUSES),
        },
        { status: STAGED_STATUSES.SUPERSEDED, deletedAt: now },
      );

      const version = await this.nextVersionWithin(
        manager,
        input.organizationId,
        input.documentId,
      );
      const saved = await manager.save(
        manager.create(StagedServiceExtractionEntity, {
          organizationId: input.organizationId,
          documentId: input.documentId,
          fileId: input.fileId,
          fileName: input.fileName,
          vendorId: input.vendorId,
          attributeSet: input.attributeSet,
          version,
          origin: input.origin ?? STAGED_ORIGINS.EXTRACT,
          // ponytail: jsonb can't store  ; strip NULs that leak in from PDF/LLM text
          services: stripNuls(input.services),
          status: input.status ?? STAGED_STATUSES.STAGED,
        }),
      );
      this.logger.debug(
        `staged doc=${input.documentId} v${version} origin=${saved.origin} services=${input.services.length}`,
      );
      return saved;
    });
  }

  /**
   * Flip the staged row COMMITTED and its owning document COMMITTED in ONE
   * transaction — a crash can no longer leave a committed row under a non-committed
   * doc. save() (not a status-only update) is deliberate: the commit flow's no-change
   * path writes the reconciled services back through this row.
   */
  markCommitted(
    row: StagedServiceExtractionEntity,
  ): Promise<StagedServiceExtractionEntity> {
    row.status = STAGED_STATUSES.COMMITTED;
    row.committedAt = new Date();
    return this.repo.manager.transaction(async (manager) => {
      const saved = await manager.save(row);
      await manager.update(
        DocumentEntity,
        { id: row.documentId, organizationId: row.organizationId },
        { status: DOCUMENT_STATUSES.COMMITTED },
      );
      return saved;
    });
  }

  async isCommitted(
    organizationId: string,
    documentId: string,
  ): Promise<boolean> {
    const count = await this.repo.countBy({
      organizationId,
      documentId,
      status: STAGED_STATUSES.COMMITTED,
    });
    return count > 0;
  }

  async supersedeForDocuments(
    organizationId: string,
    documentIds: string[],
  ): Promise<void> {
    if (!documentIds.length) return;
    await this.repo.update(
      {
        organizationId,
        documentId: In(documentIds),
        status: In(LIVE_STAGED_STATUSES),
      },
      { status: STAGED_STATUSES.SUPERSEDED, deletedAt: new Date() },
    );
    this.logger.debug(
      `superseded staged rows for ${documentIds.length} doc(s)`,
    );
  }

  /**
   * Flip the document's live staged row between the two in-review statuses
   * (staged ⇄ ready_to_commit) in place — no new version. Guarded on `from`, so it's
   * idempotent and can't touch a committed/superseded row. Returns the updated live
   * row, or null when no row was in the `from` state.
   */
  async setReviewStatus(
    organizationId: string,
    documentId: string,
    from: StagedStatus,
    to: StagedStatus,
  ): Promise<StagedServiceExtractionEntity | null> {
    const result = await this.repo.update(
      { organizationId, documentId, status: from },
      { status: to },
    );
    if (!result.affected) return null;
    return this.findLatestStaged(organizationId, documentId);
  }

  /**
   * Resolve staged-row ids to their live rows (soft-deleted superseded rows excluded
   * by default) for batch commit. The caller checks each row's status before committing.
   */
  async findLiveByIds(
    organizationId: string,
    ids: string[],
  ): Promise<StagedServiceExtractionEntity[]> {
    if (!ids.length) return [];
    return this.repo.find({ where: { organizationId, id: In(ids) } });
  }
}
