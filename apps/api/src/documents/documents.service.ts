import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  FindOperator,
  In,
  LessThanOrEqual,
  MoreThanOrEqual,
  Not,
  Repository,
} from 'typeorm';
import { ContentEntity, DocumentEntity, FileEntity } from '@nom/database';
import {
  DOCUMENT_STATUSES,
  DOCUMENT_TYPES,
  RULE_CATEGORIES,
} from '@nom/shared';
import type { DocumentStatus, DocumentType, RuleCategory } from '@nom/shared';
import type {
  DiscardDocumentResultDto,
  DocumentListDto,
  ReviewCompletionResultDto,
} from '@nom/dtos';
import type { OrgSession } from '../auth/auth.types.js';
import { getAttributeSet } from '../attribute-set';
import { RulesService, type SelectedRules } from '../rules/rules.service';
import {
  DocumentExtractor,
  type ExtractedDocument,
} from './extraction/document-extractor';
import { DocumentValidationFlow } from './document-validation.flow';
import { reviewStatusOf } from './helpers/utils';
import { ExtractResult } from '@/common/types.js';
import { mdToPlain } from '../common/text';

// A file's extraction phase maps to its rule category: source docs feed service
// extraction, transaction docs feed line-item extraction.
function extractionCategory(documentType: DocumentType): RuleCategory {
  return documentType === DOCUMENT_TYPES.SOURCE
    ? RULE_CATEGORIES.SERVICE_EXTRACTION
    : RULE_CATEGORIES.LINE_ITEM_EXTRACTION;
}

// Filters + offset pagination for listDocuments. All optional; when `limit` is
// omitted the list is unpaged (source endpoint).
interface ListDocumentsOptions {
  vendorId?: string;
  status?: DocumentStatus;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}

// Orchestrates the document ingestion pipeline (extract → validate). Extraction,
// vendor matching, and the graph mirror each live in a dedicated collaborator.
@Injectable()
export class DocumentsService {
  constructor(
    @InjectRepository(DocumentEntity)
    private readonly documentsRepo: Repository<DocumentEntity>,
    @InjectRepository(ContentEntity)
    private readonly contentRepo: Repository<ContentEntity>,
    @InjectRepository(FileEntity)
    private readonly filesRepo: Repository<FileEntity>,
    private readonly documentExtractor: DocumentExtractor,
    private readonly rulesService: RulesService,
    private readonly validationFlow: DocumentValidationFlow,
  ) {}

  private readonly log = new Logger(DocumentsService.name);

  // Step 1 — extract: fetch each raw file, run the multimodal extractor, persist
  // a `documents` row (status=extracted) + its content chunks.
  async extractMetadata(
    session: OrgSession,
    fileIds: string[],
  ): Promise<ExtractResult[]> {
    const organizationId = session.session.activeOrganizationId;
    const files = await this.filesRepo.findBy({
      id: In(fileIds),
      organizationId,
    });
    if (files.length !== fileIds.length)
      throw new NotFoundException('One or more files not found');

    // Block re-extraction of files that already have a committed document.
    // A file is one physical document, so fileId alone identifies it.
    const committed = await this.documentsRepo.findBy({
      fileId: In(fileIds),
      organizationId,
      status: DOCUMENT_STATUSES.COMMITTED,
    });
    if (committed.length)
      throw new BadRequestException(
        `Cannot re-extract committed file(s): ${committed.map((d) => d.fileId).join(', ')}`,
      );

    // LLM calls are concurrency-bounded inside extractMany (LLM_MAX_CONCURRENCY);
    // outcomes are order-aligned with `files` and failures are isolated per-file.
    // Persistence is independent per file.
    this.log.log(`extracting metadata for ${files.length} file(s)`);
    // Vendor rules are vendor-scoped and category = the file's extraction phase, so
    // resolve them per file (a batch may mix vendors/types). Files without a vendor get
    // none. Keep the full selection to record which rules were applied, post-persist.
    const selectedByFile = new Map<string, SelectedRules>();
    await Promise.all(
      files.map(async (file) => {
        if (!file.vendorId) return;
        const selected = await this.rulesService.rulesFor(
          organizationId,
          file.vendorId,
          extractionCategory(file.documentType),
          file.name,
        );
        if (selected) selectedByFile.set(file.id, selected);
      }),
    );
    const rulesByFile = new Map(
      [...selectedByFile].map(([fileId, s]) => [fileId, s.text]),
    );
    const outcomes = await this.documentExtractor.extractMany(
      files,
      rulesByFile,
    );
    const results = await Promise.all(
      outcomes.map((o) =>
        o.ok
          ? this.persist(organizationId, o.file, o.document)
          : this.persistFailed(organizationId, o.file, o.error),
      ),
    );
    // Track applied rules once the document rows exist (extractMetadata mints them here).
    await Promise.all(
      results.flatMap((r) => {
        const selected = selectedByFile.get(r.fileId);
        const file = files.find((f) => f.id === r.fileId);
        if (!selected || !file || r.status === DOCUMENT_STATUSES.REJECTED)
          return [];
        return [
          this.rulesService.markRulesApplied({
            tenantId: organizationId,
            documentId: r.documentId,
            documentType: file.documentType,
            category: extractionCategory(file.documentType),
            ruleIds: selected.ruleIds,
          }),
        ];
      }),
    );
    const failed = outcomes.filter((o) => !o.ok).length;
    const key = (r: ExtractResult) =>
      r.metadata.validFrom ?? r.metadata.documentDate ?? r.fileId;
    this.log.log(
      `extracted ${results.length - failed} document(s)` +
        (failed ? `, ${failed} failed` : ''),
    );
    return results.sort((a, b) => key(a).localeCompare(key(b)));
  }

  // A file whose extraction failed (e.g. too large / corrupt): persist a REJECTED
  // row so the failure is visible per-file and the rest of the batch still commits.
  private async persistFailed(
    organizationId: string,
    file: FileEntity,
    error: string,
  ): Promise<ExtractResult> {
    const metadata = { isFinancial: false, attributeSet: null };
    const document = await this.documentsRepo.save(
      this.documentsRepo.create({
        organizationId,
        fileId: file.id,
        vendorId: file.vendorId,
        documentType: file.documentType,
        status: DOCUMENT_STATUSES.REJECTED,
        metadata,
        warnings: [],
        rejectReason: error,
      }),
    );
    this.log.warn(`extraction failed file=${file.id}: ${error}`);
    return {
      documentId: document.id,
      fileId: file.id,
      status: document.status,
      metadata,
    };
  }

  private async persist(
    organizationId: string,
    file: FileEntity,
    { metadata, sections }: ExtractedDocument,
  ): Promise<ExtractResult> {
    // The file carries its type (set at upload); the document inherits it.
    const documentType = file.documentType;
    // Retire any prior live documents for this file so only one active row remains.
    const now = new Date();
    await this.documentsRepo.update(
      {
        organizationId,
        fileId: file.id,
        documentType,
        status: Not(
          In([
            DOCUMENT_STATUSES.COMMITTED,
            DOCUMENT_STATUSES.SUPERSEDED,
            DOCUMENT_STATUSES.DISCARDED,
          ]),
        ),
      },
      { status: DOCUMENT_STATUSES.SUPERSEDED, deletedAt: now },
    );

    const document = await this.documentsRepo.save(
      this.documentsRepo.create({
        organizationId,
        fileId: file.id,
        vendorId: file.vendorId,
        documentType,
        attributeSet: metadata.attributeSet ?? undefined,
        status: DOCUMENT_STATUSES.EXTRACTED,
        metadata,
        warnings: [],
        effectiveFrom: metadata.validFrom
          ? new Date(metadata.validFrom)
          : metadata.documentDate &&
              !Number.isNaN(Date.parse(metadata.documentDate))
            ? new Date(metadata.documentDate)
            : undefined,
        effectiveTo: metadata.validTo ? new Date(metadata.validTo) : undefined,
      }),
    );

    if (sections.length > 0) {
      await this.contentRepo.save(
        sections.map((s, i) =>
          this.contentRepo.create({
            organizationId,
            documentId: document.id,
            documentType,
            label: s.label,
            text: mdToPlain(s.text),
            position: i,
            metadata: { page: s.page, totalPages: metadata.pageCount ?? null },
          }),
        ),
      );
    }

    return {
      documentId: document.id,
      fileId: file.id,
      status: document.status,
      metadata,
    };
  }

  // Document-centric listing for a type (source / transaction): the org's active
  // documents (soft-deleted superseded/discarded rows are excluded by TypeORM,
  // rejected rows excluded explicitly since they're no longer soft-deleted),
  // newest-first by effective date, with their file names. Shared by the source and
  // transaction controllers so neither duplicates the query.
  async listDocuments(
    session: OrgSession,
    documentType: DocumentType,
    opts: ListDocumentsOptions = {},
  ): Promise<DocumentListDto> {
    const organizationId = session.session.activeOrganizationId;
    const { vendorId, status, dateFrom, dateTo, page, limit } = opts;
    const from = dateFrom ? new Date(dateFrom) : undefined;
    const to = dateTo ? new Date(dateTo) : undefined;
    let effectiveFrom: FindOperator<Date> | undefined;
    if (from && to) effectiveFrom = Between(from, to);
    else if (from) effectiveFrom = MoreThanOrEqual(from);
    else if (to) effectiveFrom = LessThanOrEqual(to);
    const [documents, totalCount] = await this.documentsRepo.findAndCount({
      where: {
        organizationId,
        documentType,
        // Explicit status filter wins; otherwise keep excluding rejected rows.
        status: status ?? Not(DOCUMENT_STATUSES.REJECTED),
        ...(vendorId ? { vendorId } : {}),
        ...(effectiveFrom ? { effectiveFrom } : {}),
      },
      relations: { vendor: true },
      order: { effectiveFrom: 'DESC', createdAt: 'DESC' },
      // Paginate only when a limit is given (transaction list); source list is unpaged.
      ...(limit ? { skip: ((page ?? 1) - 1) * limit, take: limit } : {}),
    });
    const fileIds = [...new Set(documents.map((d) => d.fileId))];
    const files = fileIds.length
      ? await this.filesRepo.findBy({ id: In(fileIds), organizationId })
      : [];
    const fileName = new Map(files.map((f) => [f.id, f.name]));
    const fileSize = new Map(files.map((f) => [f.id, f.sizeBytes]));
    return {
      documents: documents.map((d) => {
        // Strip internal provenance/reasoning fields before exposing to the frontend.
        const metadata = { ...d.metadata };
        delete metadata.log;
        delete metadata.validation;
        delete metadata.typeMismatchReason;
        return {
          documentId: d.id,
          fileId: d.fileId,
          fileName: fileName.get(d.fileId) ?? '',
          status: d.status,
          reviewStatus: reviewStatusOf(d.reviewCompleted),
          vendorId: d.vendorId ?? null,
          vendorName: d.vendor?.name ?? null,
          amountKeys:
            getAttributeSet(d.attributeSet ?? metadata.attributeSet)
              ?.amountKeys ?? [],
          fileSizeBytes: fileSize.get(d.fileId) ?? null,
          effectiveFrom: d.effectiveFrom?.toISOString() ?? null,
          createdAt: d.createdAt.toISOString(),
          updatedAt: d.updatedAt.toISOString(),
          metadata,
        };
      }),
      totalCount,
      page: page ?? 1,
      limit: limit ?? totalCount,
    };
  }

  // Soft-delete a document (invoice): mark DISCARDED + deletedAt so it drops out of
  // every default `find`, keeping the row for audit. Committed work is never destroyed.
  async discardDocument(
    session: OrgSession,
    documentId: string,
    documentType: DocumentType,
  ): Promise<DiscardDocumentResultDto> {
    const organizationId = session.session.activeOrganizationId;
    const document = await this.documentsRepo.findOneBy({
      id: documentId,
      organizationId,
      documentType,
    });
    if (!document) throw new NotFoundException('Document not found');
    if (document.status === DOCUMENT_STATUSES.COMMITTED)
      throw new BadRequestException('Cannot delete a committed document');
    // ponytail: no line-item/graph cleanup — orphaned rows are only reachable via the
    // document, so they're inert once it's hidden. Add cleanup only if orphans bite.
    await this.documentsRepo.update(
      { id: documentId, organizationId },
      { status: DOCUMENT_STATUSES.DISCARDED, deletedAt: new Date() },
    );
    this.log.log(`discarded document=${documentId}`);
    return { documentId, status: DOCUMENT_STATUSES.DISCARDED };
  }

  // Step 2 — validate: delegated to the DocumentValidationFlow (financial /
  // type / attributeSet / date gates, vendor-match warning, graph mirror).
  async validate(session: OrgSession, id: string, documentType: DocumentType) {
    return this.validationFlow.validate(session, id, documentType);
  }

  // Toggle the reviewer's review-complete flag on a transaction document. Reversible.
  async setReviewCompleted(
    session: OrgSession,
    documentId: string,
    documentType: DocumentType,
    reviewCompleted: boolean,
  ): Promise<ReviewCompletionResultDto> {
    const organizationId = session.session.activeOrganizationId;
    const document = await this.documentsRepo.findOneBy({
      id: documentId,
      organizationId,
      documentType,
    });
    if (!document) throw new NotFoundException('Document not found');
    await this.documentsRepo.update(
      { id: documentId, organizationId },
      { reviewCompleted },
    );
    return {
      documentId,
      reviewCompleted,
      reviewStatus: reviewStatusOf(reviewCompleted),
    };
  }
}
