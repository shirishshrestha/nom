import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ContentEntity, DocumentEntity } from '@nom/database';
import {
  DOCUMENT_STATUSES,
  STAGED_ORIGINS,
  STAGED_STATUSES,
} from '@nom/shared';
import type {
  CommitAllFailureDto,
  CommitAllItemDto,
  CommitAllResultDto,
  ContentChunkDto,
  ReviewStatusResultDto,
} from '@nom/dtos';
import { AttributeSetRegistry, toAttributeSetDto } from '../attribute-set';
import type { OrgSession } from '../auth/auth.types.js';
import { uncommittedSourceDocsWhere } from './helpers/utils';
import { StagingRepository } from './staging/staging.repository';
import {
  overlayEdits,
  toReview,
  toUncommittedDocument,
  type ServiceEdit,
} from './staging/staging.mapper';
import { SourceExtractFlow } from './extraction/extract-services.flow';
import { SourceCommitFlow } from './commit/commit-services.flow';

@Injectable()
export class SourceService {
  private readonly logger = new Logger(SourceService.name);

  constructor(
    @InjectRepository(DocumentEntity)
    private readonly documentsRepo: Repository<DocumentEntity>,
    @InjectRepository(ContentEntity)
    private readonly contentRepo: Repository<ContentEntity>,
    private readonly staging: StagingRepository,
    private readonly attributeSets: AttributeSetRegistry,
    private readonly extractFlow: SourceExtractFlow,
    private readonly commitFlow: SourceCommitFlow,
  ) {}

  /**
   * Extract priced service line-items into a versioned staging snapshot.
   * Orchestrated phase-by-phase in SourceExtractFlow.
   */
  extractServices(session: OrgSession, documentId: string) {
    return this.extractFlow.run(session, documentId);
  }

  /**
   * A STAGED doc carries its grouped review services; VALIDATED comes back with
   * empty services so the review page's advancer can extract-services it (the
   * client drives the next action from `status`). EXTRACTED docs aren't validated
   * yet, so they're excluded from the review feed.
   */
  async listUncommittedForVendor(organizationId: string, vendorId: string) {
    const docs = await this.documentsRepo.find({
      where: uncommittedSourceDocsWhere(organizationId, vendorId, [
        DOCUMENT_STATUSES.VALIDATED,
        DOCUMENT_STATUSES.STAGED,
      ]),
      relations: { file: true },
    });

    // Oldest-first by effective date so top-to-bottom committing leaves the newest
    // rate card as the live one under commit-order supersession in the graph.
    // Fallback: effectiveFrom → documentDate → upload time.
    const orderKey = (d: DocumentEntity): string => {
      const dd = d.metadata?.documentDate;
      return (
        d.effectiveFrom?.toISOString() ??
        (dd && !Number.isNaN(Date.parse(dd))
          ? new Date(dd).toISOString()
          : null) ??
        d.createdAt?.toISOString() ??
        ''
      );
    };
    docs.sort((a, b) => orderKey(a).localeCompare(orderKey(b)));

    // Fetch latest staged snapshot per doc once to avoid N+1.
    const staged = await this.staging.latestUncommittedForVendor(
      organizationId,
      vendorId,
    );
    const stagedByDoc = new Map(staged.map((r) => [r.documentId, r]));

    const documents = docs.map((doc) =>
      toUncommittedDocument(doc, stagedByDoc),
    );

    // All the vendor's docs share one attribute set — embed it so the review UI
    // renders fields dynamically without a second call.
    const setKey = docs.find((d) => d.attributeSet)?.attributeSet;
    const attributeSet = setKey ? this.attributeSets.get(setKey) : undefined;
    return {
      documents,
      attributeSet: attributeSet ? toAttributeSetDto(attributeSet) : null,
    };
  }

  /**
   * "Last" = max(document.updatedAt, latest staged row's createdAt), because
   * staging a new version writes a fresh staging row without bumping the
   * document's updatedAt.
   */
  async findLatestUncommittedDocument(organizationId: string) {
    const docs = await this.documentsRepo.find({
      where: uncommittedSourceDocsWhere(organizationId, undefined, [
        DOCUMENT_STATUSES.STAGED,
      ]),
      relations: { file: true },
    });
    if (docs.length === 0)
      return { document: null, vendorId: null, attributeSet: null };

    const staged = await this.staging.latestUncommittedForOrg(organizationId);
    const stagedByDoc = new Map(staged.map((r) => [r.documentId, r]));

    const recency = (d: DocumentEntity): number =>
      Math.max(
        d.updatedAt?.getTime() ?? 0,
        stagedByDoc.get(d.id)?.createdAt?.getTime() ?? 0,
      );
    const doc = docs.reduce((a, b) => (recency(b) > recency(a) ? b : a));

    const document = toUncommittedDocument(doc, stagedByDoc);

    const attributeSet = doc.attributeSet
      ? this.attributeSets.get(doc.attributeSet)
      : undefined;
    return {
      document,
      vendorId: doc.vendorId ?? null,
      attributeSet: attributeSet ? toAttributeSetDto(attributeSet) : null,
    };
  }

  /** Only EXTRACTED/VALIDATED/STAGED docs are touched - committed work is never affected. */
  async discardUncommittedForVendor(organizationId: string, vendorId: string) {
    const docs = await this.documentsRepo.find({
      where: uncommittedSourceDocsWhere(organizationId, vendorId),
    });
    const documentIds = docs.map((d) => d.id);
    if (documentIds.length === 0)
      return { documentIds, status: DOCUMENT_STATUSES.DISCARDED };

    await this.staging.supersedeForDocuments(organizationId, documentIds);
    await this.documentsRepo.update(
      { id: In(documentIds), organizationId },
      { status: DOCUMENT_STATUSES.DISCARDED, deletedAt: new Date() },
    );
    this.logger.log(
      `discarded ${documentIds.length} doc(s) vendor=${vendorId}`,
    );
    // ponytail: no graph cleanup — uncommitted docs have at most inert SourceDocument
    // nodes (no DEFINES edges); re-MERGEd on any future validate. Add cleanup only if
    // orphan nodes bite.
    return { documentIds, status: DOCUMENT_STATUSES.DISCARDED };
  }

  async getContentChunk(
    organizationId: string,
    contentId: string,
  ): Promise<ContentChunkDto> {
    const chunk = await this.contentRepo.findOneBy({
      id: contentId,
      organizationId,
    });
    if (!chunk) throw new NotFoundException('Content chunk not found');

    // Resolve the originating document's filename (ContentEntity has no fileId).
    const document = await this.documentsRepo.findOne({
      where: { id: chunk.documentId, organizationId },
      relations: { file: true },
    });

    return {
      id: chunk.id,
      label: chunk.label,
      text: chunk.text,
      position: chunk.position,
      fileName: document?.file?.name ?? '',
      page: (chunk.metadata?.page as number | null) ?? null,
      totalPages: document?.metadata?.pageCount ?? null,
    };
  }

  /**
   * Promote the reviewed services into Neo4j (commit the change-set).
   * Orchestrated phase-by-phase in SourceCommitFlow.
   */
  saveStagedServices(
    session: OrgSession,
    documentId: string,
    edits: ServiceEdit[],
    deletedServiceIds: string[] = [],
  ) {
    return this.commitFlow.run(session, documentId, edits, deletedServiceIds);
  }

  /**
   * A committed document's services (with their graph node id) + the attribute set,
   * for rendering the committed-service edit UI. Throws if the doc isn't committed.
   */
  async getCommittedServices(organizationId: string, documentId: string) {
    if (!(await this.staging.isCommitted(organizationId, documentId)))
      throw new BadRequestException('Document is not committed');
    const latest = await this.staging.findLatestStaged(
      organizationId,
      documentId,
    );
    if (!latest) throw new NotFoundException('No staged services for document');
    const attributeSet = latest.attributeSet
      ? this.attributeSets.get(latest.attributeSet)
      : undefined;
    return {
      documentId,
      services: latest.services.map(toReview),
      attributeSet: attributeSet ? toAttributeSetDto(attributeSet) : null,
    };
  }

  /**
   * Edit ONE already-committed service: re-commit the document through the amend path
   * so the edited line becomes a new graph node and its prior node is retired +
   * AMENDS-linked. `serviceId` comes from the route; `edit` carries the changed fields.
   */
  async editCommittedService(
    session: OrgSession,
    documentId: string,
    serviceId: string,
    edit: Omit<ServiceEdit, 'id'>,
  ) {
    const organizationId = session.session.activeOrganizationId;
    if (!(await this.staging.isCommitted(organizationId, documentId)))
      throw new BadRequestException('Document is not committed');
    return this.commitFlow.runEdit(session, documentId, [
      { id: serviceId, ...edit },
    ]);
  }

  /**
   * Park a reviewed document as `ready_to_commit` WITHOUT promoting it to the graph:
   * persist the reviewer's edits (a new save snapshot when anything changed, else flip
   * the live row in place) and flag it ready. Reversible via unmarkReady. The
   * authoritative canonical adjudication still runs later, at commit-all.
   */
  async markReady(
    session: OrgSession,
    documentId: string,
    edits: ServiceEdit[],
    deletedServiceIds: string[] = [],
  ): Promise<ReviewStatusResultDto> {
    const organizationId = session.session.activeOrganizationId;
    const latest = await this.staging.findLatestStaged(
      organizationId,
      documentId,
    );
    if (!latest)
      throw new NotFoundException('No staged services — run extract first');
    if (
      latest.status !== STAGED_STATUSES.STAGED &&
      latest.status !== STAGED_STATUSES.READY
    )
      throw new BadRequestException('Document is not in review');

    const { services } = overlayEdits(
      latest.services,
      edits,
      deletedServiceIds,
      session.user.id,
      latest.version,
    );
    const changed =
      JSON.stringify(services) !== JSON.stringify(latest.services);

    // Edits → a new versioned save snapshot flagged READY (supersedes the live row, so
    // the diff is tracked). No edits → just flip the live row's status in place.
    const row = changed
      ? await this.staging.stageExtraction({
          organizationId,
          documentId,
          fileId: latest.fileId,
          fileName: latest.fileName,
          vendorId: latest.vendorId,
          attributeSet: latest.attributeSet,
          services,
          origin: STAGED_ORIGINS.SAVE,
          status: STAGED_STATUSES.READY,
        })
      : ((await this.staging.setReviewStatus(
          organizationId,
          documentId,
          latest.status,
          STAGED_STATUSES.READY,
        )) ?? latest);

    this.logger.log(
      `mark-ready doc=${documentId} v${row.version} changed=${changed}`,
    );
    return {
      documentId,
      version: row.version,
      reviewStatus: row.status,
    };
  }

  /** Move a `ready_to_commit` document back to `staged` for further review. */
  async unmarkReady(
    session: OrgSession,
    documentId: string,
  ): Promise<ReviewStatusResultDto> {
    const organizationId = session.session.activeOrganizationId;
    const row = await this.staging.setReviewStatus(
      organizationId,
      documentId,
      STAGED_STATUSES.READY,
      STAGED_STATUSES.STAGED,
    );
    if (!row) throw new BadRequestException('Document is not marked ready');
    return {
      documentId,
      version: row.version,
      reviewStatus: row.status,
    };
  }

  /**
   * Commit a batch of reviewer-accepted staged rows. Each id must resolve to a live
   * row that belongs to `vendorId` and is `ready_to_commit`; anything else is reported
   * in `failed` rather than aborting the batch. Each accepted doc goes through the full
   * SourceCommitFlow (reconcile → graph MERGE → COMMITTED), so commit-all never bypasses
   * the authoritative canonical adjudication. Per-doc independent: one failure never
   * rolls back the others.
   */
  async commitAll(
    session: OrgSession,
    vendorId: string,
    stagedIds: string[],
  ): Promise<CommitAllResultDto> {
    const organizationId = session.session.activeOrganizationId;
    const ids = [...new Set(stagedIds)];
    const rows = await this.staging.findLiveByIds(organizationId, ids);
    const byId = new Map(rows.map((r) => [r.id, r]));

    const committed: CommitAllItemDto[] = [];
    const failed: CommitAllFailureDto[] = [];
    for (const stagedId of ids) {
      const row = byId.get(stagedId);
      if (!row) {
        failed.push({
          stagedId,
          reason: 'Unknown or already-committed staged id',
        });
        continue;
      }
      if (row.vendorId !== vendorId) {
        failed.push({
          stagedId,
          reason: 'Staged row belongs to a different vendor',
        });
        continue;
      }
      if (row.status !== STAGED_STATUSES.READY) {
        failed.push({
          stagedId,
          reason: `Not ready_to_commit (status=${row.status})`,
        });
        continue;
      }
      try {
        const res = await this.commitFlow.run(session, row.documentId, [], []);
        committed.push({
          stagedId,
          documentId: res.documentId,
          version: res.version,
          serviceCount: res.serviceCount,
          canonicalCount: res.canonicalCount,
        });
      } catch (e) {
        failed.push({
          stagedId,
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    }

    this.logger.log(
      `commit-all vendor=${vendorId} committed=${committed.length} failed=${failed.length}`,
    );
    return { committed, failed };
  }
}
