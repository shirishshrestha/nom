import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ContentEntity, DocumentEntity } from '@nom/database';
import { DOCUMENT_STATUSES, RULE_CATEGORIES } from '@nom/shared';
import type { DocumentMetadata, StagedService } from '@nom/shared';
import type { ExtractServicesResultDto } from '@nom/dtos';
import { toAttributeSetDto, type AttributeSet } from '../../attribute-set';
import type { OrgSession } from '../../auth/auth.types.js';
import { DocumentContextLoader } from '../../shared-loading/document-context.loader';
import {
  CanonicalRegistryRepository,
  type CanonicalRegistryEntry,
  type TierRegistryEntry,
} from '../../infra/graph/canonical-registry.repository';
import { StagingRepository } from '../staging/staging.repository';
import { toReview } from '../staging/staging.mapper';
import { uncommittedSourceDocsWhere } from '../helpers/utils';
import { ServiceExtractor } from './service-extractor';
import { RulesService } from '../../rules/rules.service';

/**
 * State threaded through every step of the extract flow — each facade method returns an
 * updated copy. Fields are filled progressively; `run` guarantees a step's inputs are
 * set before it reads them.
 */
export interface ExtractState {
  readonly organizationId: string;
  readonly documentId: string;
  vendorId?: string;
  fileId: string;
  fileName: string;
  attributeSet: AttributeSet | null;
  metadata: DocumentMetadata;
  sections: ContentEntity[];
  registry: CanonicalRegistryEntry[];
  tiers: TierRegistryEntry[];
  services: StagedService[];
  version: number;
}

/**
 * Extract a validated source document's priced service lines and stage them as a
 * versioned snapshot, phase by phase. Each method is a thin facade over ONE injected
 * collaborator (SRP); `run` composes them and owns the only control flow. Split out
 * of SourceService so the steps stay uniform, mirroring TransactionExtractFlow.
 */
@Injectable()
export class SourceExtractFlow {
  private readonly logger = new Logger(SourceExtractFlow.name);

  constructor(
    @InjectRepository(DocumentEntity)
    private readonly documentsRepo: Repository<DocumentEntity>,
    private readonly loader: DocumentContextLoader,
    private readonly staging: StagingRepository,
    private readonly extractor: ServiceExtractor,
    private readonly canonicalRegistry: CanonicalRegistryRepository,
    private readonly rulesService: RulesService,
  ) {}

  async run(
    session: OrgSession,
    documentId: string,
  ): Promise<ExtractServicesResultDto> {
    let s = this.seed(session.session.activeOrganizationId, documentId);
    await this.guardNotCommitted(s);
    s = await this.loadContext(s);
    s = await this.loadRegistry(s);
    s = await this.extract(s);
    s = await this.stage(s);
    s = await this.markStaged(s);
    // s = await this.sweepStale(s);
    return this.toResult(s);
  }

  private seed(organizationId: string, documentId: string): ExtractState {
    return {
      organizationId,
      documentId,
      vendorId: undefined,
      fileId: '',
      fileName: '',
      attributeSet: null,
      metadata: { isFinancial: false, attributeSet: null },
      sections: [],
      registry: [],
      tiers: [],
      services: [],
      version: 0,
    };
  }

  /** staging.isCommitted — re-extraction of an already-committed document is not allowed. */
  async guardNotCommitted(s: ExtractState): Promise<void> {
    if (await this.staging.isCommitted(s.organizationId, s.documentId))
      throw new BadRequestException(
        'Document already committed — re-extraction is not allowed',
      );
  }

  /** loader.loadSourceContext — the gated source doc, its sections, and file. */
  async loadContext(s: ExtractState): Promise<ExtractState> {
    this.logger.log(`extract services start doc=${s.documentId}`);
    const { document, set, sections, file } =
      await this.loader.loadSourceContext(s.organizationId, s.documentId);
    return {
      ...s,
      vendorId: document.vendorId,
      fileId: document.fileId,
      fileName: file?.name ?? '',
      attributeSet: set,
      metadata: document.metadata,
      sections,
    };
  }

  /** canonicalRegistry — the vendor's canonical services + known tier slugs. */
  async loadRegistry(s: ExtractState): Promise<ExtractState> {
    const [registry, tiers] = await Promise.all([
      this.canonicalRegistry.findForVendor(s.organizationId, s.vendorId),
      this.canonicalRegistry.tiersForVendor(s.organizationId, s.vendorId),
    ]);
    return { ...s, registry, tiers };
  }

  /** extractor.extract — turn the sections into priced staged services. */
  async extract(s: ExtractState): Promise<ExtractState> {
    const selected = s.vendorId
      ? await this.rulesService.rulesFor(
          s.organizationId,
          s.vendorId,
          RULE_CATEGORIES.SERVICE_EXTRACTION,
          s.metadata.summary ?? s.fileName,
        )
      : undefined;
    const services = await this.extractor.extract(
      s.attributeSet!,
      s.sections,
      s.registry,
      s.tiers,
      s.metadata,
      selected?.text,
    );
    if (selected)
      await this.rulesService.markRulesApplied({
        tenantId: s.organizationId,
        documentId: s.documentId,
        documentType: s.attributeSet!.documentType,
        category: RULE_CATEGORIES.SERVICE_EXTRACTION,
        ruleIds: selected.ruleIds,
      });
    return { ...s, services };
  }

  /** staging.stageExtraction — persist the extracted services as a new staged snapshot. */
  async stage(s: ExtractState): Promise<ExtractState> {
    const row = await this.staging.stageExtraction({
      organizationId: s.organizationId,
      documentId: s.documentId,
      fileId: s.fileId,
      fileName: s.fileName,
      vendorId: s.vendorId,
      attributeSet: s.attributeSet!.key,
      services: s.services,
    });
    return { ...s, version: row.version };
  }

  /** documentsRepo.update — flag the document STAGED once the snapshot is written. */
  async markStaged(s: ExtractState): Promise<ExtractState> {
    await this.documentsRepo.update(
      { id: s.documentId, organizationId: s.organizationId },
      { status: DOCUMENT_STATUSES.STAGED },
    );
    this.logger.log(
      `extracted ${s.services.length} service(s) doc=${s.documentId} vendor=${s.vendorId ?? 'none'} v${s.version}`,
    );
    return s;
  }

  /**
   * documentsRepo.update — a fresh stage neutralizes this vendor's other still-in-progress
   * (extracted/validated) uploads so only staged docs remain in the review feed. The just-staged
   * doc is already STAGED, so the status filter excludes it. Per-vendor: skip when vendor unknown.
   * ponytail: no staging.supersedeForDocuments call — extracted/validated docs have no staged rows.
   */
  async sweepStale(s: ExtractState): Promise<ExtractState> {
    if (!s.vendorId) return s;
    const res = await this.documentsRepo.update(
      uncommittedSourceDocsWhere(s.organizationId, s.vendorId, [
        DOCUMENT_STATUSES.EXTRACTED,
        DOCUMENT_STATUSES.VALIDATED,
      ]),
      { status: DOCUMENT_STATUSES.DISCARDED, deletedAt: new Date() },
    );
    if (res?.affected)
      this.logger.log(
        `swept ${res.affected} stale doc(s) vendor=${s.vendorId}`,
      );
    return s;
  }

  private toResult(s: ExtractState): ExtractServicesResultDto {
    return {
      documentId: s.documentId,
      version: s.version,
      fileName: s.fileName,
      // Embed the attribute-set definition so the review UI renders fields dynamically.
      attributeSet: toAttributeSetDto(s.attributeSet!),
      services: s.services.map(toReview),
    };
  }
}
