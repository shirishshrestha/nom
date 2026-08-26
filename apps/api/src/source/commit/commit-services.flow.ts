import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DocumentEntity, StagedServiceExtractionEntity } from '@nom/database';
import {
  DOCUMENT_STATUSES,
  RULE_CATEGORIES,
  STAGED_ORIGINS,
} from '@nom/shared';
import type { StagedService } from '@nom/shared';
import type { SaveServicesResultDto } from '@nom/dtos';
import type { AttributeSet } from '../../attribute-set';
import type { OrgSession } from '../../auth/auth.types.js';
import { DocumentContextLoader } from '../../shared-loading/document-context.loader';
import { CanonicalRegistryRepository } from '../../infra/graph/canonical-registry.repository';
import { ServiceGraphRepository } from '../../infra/graph/service-graph.repository';
import { DocumentGraphRepository } from '../../infra/graph/document-graph.repository';
import { DOCUMENT_GRAPH_LABELS } from '../../infra/graph/graph-labels';
import { buildDocumentContext } from '../../documents/helpers/utils';
import { promptTag } from '../../infra/llm/prompt.types';
import { dedupeByBand } from '../helpers/utils';
import { StagingRepository } from '../staging/staging.repository';
import {
  applyEditForAmendment,
  overlayEdits,
  type Amendment,
  type ServiceEdit,
} from '../staging/staging.mapper';
import { CanonicalMatcher } from '../extraction/canonical-matcher';
import { ServiceReferenceDetector } from '../extraction/service-reference-detector';
import {
  CANONICAL_MATCH_PROMPT,
  SERVICE_REFERENCE_PROMPT,
} from '../service-schema';
import { RulesService } from '../../rules/rules.service';

/**
 * State threaded through every step of the commit flow — each facade method returns an
 * updated copy. Fields are filled progressively; `run` guarantees a step's inputs are
 * set before it reads them.
 */
export interface CommitState {
  readonly organizationId: string;
  readonly userId: string;
  readonly documentId: string;
  // 'commit' promotes a reviewed (uncommitted) doc; 'edit' re-commits an already-
  // committed doc, re-issuing changed lines under new ids so the graph amends them.
  readonly mode: 'commit' | 'edit';
  readonly edits: ServiceEdit[];
  readonly deletedServiceIds: string[];
  document: DocumentEntity | null;
  attributeSet: AttributeSet | null;
  latest: StagedServiceExtractionEntity | null;
  beforeJson: string;
  services: StagedService[];
  // Edit mode only: (priorId → newId) pairs for the graph AMENDS supersession.
  amendments: Amendment[];
  changed: boolean;
  row: StagedServiceExtractionEntity | null;
  canonicalCount: number;
  serviceCount: number;
}

/**
 * Commit pipeline for a reviewed source document, phase by phase: overlay the
 * reviewer's edits and removals onto the latest staged snapshot, reconcile canonicals
 * against the vendor registry, dedupe by supersession band, persist a new snapshot
 * only if anything changed, then promote to the graph and mark the doc COMMITTED. Each
 * method is a thin facade over ONE injected collaborator (SRP); `run` composes them
 * and owns the only control flow. Split out of SourceService so the steps stay
 * uniform, mirroring TransactionMatchFlow.
 */
@Injectable()
export class SourceCommitFlow {
  private readonly logger = new Logger(SourceCommitFlow.name);

  constructor(
    private readonly loader: DocumentContextLoader,
    private readonly staging: StagingRepository,
    private readonly canonicalMatcher: CanonicalMatcher,
    private readonly referenceDetector: ServiceReferenceDetector,
    private readonly canonicalRegistry: CanonicalRegistryRepository,
    private readonly serviceGraph: ServiceGraphRepository,
    private readonly documentGraph: DocumentGraphRepository,
    private readonly rulesService: RulesService,
  ) {}

  async run(
    session: OrgSession,
    documentId: string,
    edits: ServiceEdit[],
    deletedServiceIds: string[] = [],
  ): Promise<SaveServicesResultDto> {
    return this.execute(
      this.seed(session, 'commit', documentId, edits, deletedServiceIds),
    );
  }

  /**
   * Edit an ALREADY-COMMITTED document: changed lines are re-issued under new ids and
   * committed as new graph nodes, then their prior nodes are retired + AMENDS-linked
   * (see commitGraph). Same pipeline as `run`; no deletions.
   */
  async runEdit(
    session: OrgSession,
    documentId: string,
    edits: ServiceEdit[],
  ): Promise<SaveServicesResultDto> {
    return this.execute(this.seed(session, 'edit', documentId, edits, []));
  }

  private execute(s0: CommitState): Promise<SaveServicesResultDto> {
    // ponytail: no cross-store saga. Graph promotion runs BEFORE the Postgres flip and
    // the whole pipeline is re-runnable: commitGraph is a MERGE-idempotent single tx,
    // persistSnapshot no-ops when nothing changed, markCommitted is one Postgres tx.
    // A crash mid-commit is recovered by retrying the endpoint; cost is one repeated
    // reconcile LLM call. Add a saga only if that cost or a partial window ever bites.
    return (async () => {
      let s = await this.loadDoc(s0);
      s = await this.loadStaged(s);
      s = this.overlay(s);
      s = await this.reconcile(s);
      s = await this.detectReferences(s);
      s = this.dedupe(s);
      s = await this.persistSnapshot(s);
      s = await this.commitGraph(s);
      s = await this.markCommitted(s);
      return this.toResult(s);
    })();
  }

  private seed(
    session: OrgSession,
    mode: 'commit' | 'edit',
    documentId: string,
    edits: ServiceEdit[],
    deletedServiceIds: string[],
  ): CommitState {
    return {
      organizationId: session.session.activeOrganizationId,
      userId: session.user.id,
      documentId,
      mode,
      edits,
      deletedServiceIds,
      document: null,
      attributeSet: null,
      latest: null,
      beforeJson: '',
      services: [],
      amendments: [],
      changed: false,
      row: null,
      canonicalCount: 0,
      serviceCount: 0,
    };
  }

  /** loader.loadSourceDoc — the gated source doc + its resolved attribute set. */
  async loadDoc(s: CommitState): Promise<CommitState> {
    this.logger.log(
      `commit start doc=${s.documentId} edits=${s.edits.length} deleted=${s.deletedServiceIds.length}`,
    );
    const { document, set } = await this.loader.loadSourceDoc(
      s.organizationId,
      s.documentId,
    );
    // A committed rate card MUST have a vendor (see commitGraph). Fail here, before
    // reconcile burns an LLM call matching against a vendorless (empty) registry.
    if (!document.vendorId)
      throw new BadRequestException(
        'Cannot commit services for a document with no vendor',
      );
    return { ...s, document, attributeSet: set };
  }

  /** staging.findLatestStaged — the snapshot the reviewer's edits apply on top of. */
  async loadStaged(s: CommitState): Promise<CommitState> {
    const latest = await this.staging.findLatestStaged(
      s.organizationId,
      s.documentId,
    );
    if (!latest)
      throw new BadRequestException('No staged services — run extract first');
    return { ...s, latest };
  }

  /**
   * overlayEdits — apply the reviewer's attribute/title/pricingContext edits and
   * removals onto the latest snapshot. Snapshot BEFORE overlay/verify — JSON string so
   * later in-place edits to shared references can't taint change detection.
   */
  overlay(s: CommitState): CommitState {
    const beforeJson = JSON.stringify(s.latest!.services);
    if (s.mode === 'edit') {
      // Re-issue changed lines under new ids and record (priorId → newId) for the
      // graph amend; unchanged lines keep their id (no node churn).
      const { services, amendments } = applyEditForAmendment(
        s.latest!.services,
        s.edits,
        s.userId,
        s.latest!.version,
      );
      return { ...s, beforeJson, services, amendments };
    }
    const { services } = overlayEdits(
      s.latest!.services,
      s.edits,
      s.deletedServiceIds,
      s.userId,
      s.latest!.version,
    );
    if (services.length === 0)
      throw new BadRequestException(
        'Cannot commit an empty service set — discard the document instead',
      );
    return { ...s, beforeJson, services };
  }

  /**
   * Verifies every line's canonical against the vendor registry (Haiku, batched):
   * reuses existing canonical names where the concept matches, splits over-merged
   * lines. Mutates `services` in place, logging only the lines that changed.
   */
  async reconcile(s: CommitState): Promise<CommitState> {
    const vendorId = s.document!.vendorId;
    const [registry, tierRegistry, selected] = await Promise.all([
      this.canonicalRegistry.findForVendor(s.organizationId, vendorId),
      this.canonicalRegistry.tiersForVendor(s.organizationId, vendorId),
      vendorId
        ? this.rulesService.rulesFor(
            s.organizationId,
            vendorId,
            RULE_CATEGORIES.SERVICE_GROUPING,
            s.services.map((l) => l.title).join(' '),
          )
        : undefined,
    ]);
    const resolved = await this.canonicalMatcher.match(
      s.attributeSet!,
      s.services.map((line) => ({
        id: line.id,
        canonicalName: line.canonicalName,
        title: line.title,
        tier: line.tier,
        pricingContext: line.pricingContext,
        attributes: line.attributes,
        sectionContext: line.meta.sectionContext,
      })),
      registry,
      tierRegistry,
      s.organizationId,
      vendorId ?? '',
      s.documentId,
      selected?.text,
    );
    if (selected)
      await this.rulesService.markRulesApplied({
        tenantId: s.organizationId,
        documentId: s.documentId,
        documentType: s.attributeSet!.documentType,
        category: RULE_CATEGORIES.SERVICE_GROUPING,
        ruleIds: selected.ruleIds,
      });

    let changed = 0;
    for (const line of s.services) {
      const hit = resolved.get(line.id);
      if (!hit) continue;
      if (
        hit.canonicalName === line.canonicalName &&
        hit.canonicalDescription === line.canonicalDescription &&
        hit.tierSlug === line.tierSlug
      )
        continue;
      line.canonicalName = hit.canonicalName;
      line.canonicalDescription = hit.canonicalDescription;
      line.tierSlug = hit.tierSlug;
      line.log = `${line.log}\n· canonical reconciled by ${promptTag(CANONICAL_MATCH_PROMPT)}`;
      changed++;
    }
    this.logger.debug(
      `reconciled ${s.services.length} line(s), ${changed} changed vendor=${vendorId ?? 'none'}`,
    );
    return s;
  }

  /**
   * Detect cross-service pricing references ("B = 40% of A") now that canonicals are
   * final, stamping the resolved `pricingRef` onto each referencing line so commitGraph
   * can wire a PRICED_FROM edge. Fail-soft — references to unknown/own canonicals are
   * dropped by the detector; a no-reference document is a no-op.
   */
  async detectReferences(s: CommitState): Promise<CommitState> {
    const refs = await this.referenceDetector.detect(
      s.attributeSet!,
      s.services.map((l) => ({
        id: l.id,
        canonicalName: l.canonicalName,
        title: l.title,
        pricingContext: l.pricingContext,
      })),
      s.organizationId,
      s.documentId,
    );
    if (refs.size === 0) return s;

    const tag = promptTag(SERVICE_REFERENCE_PROMPT);
    const services = s.services.map((l) => {
      const ref = refs.get(l.id);
      return ref
        ? {
            ...l,
            pricingRef: ref,
            log: `${l.log}\n· priced-from ${ref.referencedCanonical} detected by ${tag}`,
          }
        : l;
    });
    this.logger.debug(
      `detected ${refs.size} pricing reference(s) doc=${s.documentId}`,
    );
    return { ...s, services };
  }

  /** dedupeByBand — collapse lines sharing the graph supersession key. */
  dedupe(s: CommitState): CommitState {
    const services = dedupeByBand(s.services);
    // A new snapshot requires reviewer intent (edits/deletions) AND a real content
    // change. System-side canonical reconciliation alone never versions — it commits
    // in place, so save doesn't churn staging versions (and stale ids) on no-op saves.
    const hasReviewerChanges =
      s.edits.length > 0 || s.deletedServiceIds.length > 0;
    const changed =
      hasReviewerChanges && JSON.stringify(services) !== s.beforeJson;
    return { ...s, services, changed };
  }

  /**
   * staging.stageExtraction — persist a new human-reviewed snapshot only when
   * something actually changed; otherwise commit the existing staged row in place.
   */
  async persistSnapshot(s: CommitState): Promise<CommitState> {
    if (!s.changed) {
      // Deliberate entity mutation: markCommitted save()s this row, persisting the
      // reconciled/deduped services onto the existing version (no new snapshot).
      s.latest!.services = s.services;
      return { ...s, row: s.latest };
    }
    const row = await this.staging.stageExtraction({
      organizationId: s.organizationId,
      documentId: s.documentId,
      fileId: s.latest!.fileId,
      fileName: s.latest!.fileName,
      vendorId: s.latest!.vendorId,
      attributeSet: s.latest!.attributeSet,
      services: s.services,
      origin: STAGED_ORIGINS.SAVE,
    });
    return { ...s, row };
  }

  /**
   * Atomic graph promotion. FATAL on failure (the graph is authoritative for
   * committed services) - let it propagate so the doc status is not advanced.
   */
  async commitGraph(s: CommitState): Promise<CommitState> {
    const document = s.document!;
    // A committed rate card MUST have a vendor — otherwise all vendorless canonicals
    // for the tenant collapse onto one shared {vendorId:null} node in the graph.
    if (!document.vendorId)
      throw new BadRequestException(
        'Cannot commit services for a document with no vendor',
      );
    // Ensure the SourceDocument node exists in Neo4j before the MATCH in
    // commitServices — it may have been skipped at validation time if the
    // vendor was assigned after the document was first processed.
    const label = DOCUMENT_GRAPH_LABELS[document.documentType];
    if (label) {
      await this.documentGraph.upsertDocument({
        documentId: document.id,
        tenantId: s.organizationId,
        vendorId: document.vendorId,
        label,
        attributeSet: document.attributeSet ?? null,
        documentKind: document.metadata.documentKind ?? null,
        currency: document.metadata.currency ?? null,
        referenceNumbers: document.metadata.referenceNumbers ?? [],
        context: buildDocumentContext(document.metadata),
        effectiveFrom: document.effectiveFrom?.toISOString() ?? null,
        effectiveTo: document.effectiveTo?.toISOString() ?? null,
      });
    }
    const validFrom = document.effectiveFrom?.toISOString() ?? null;
    const now = new Date().toISOString();
    const { canonicalCount, serviceCount } =
      await this.serviceGraph.commitServices({
        documentId: document.id,
        tenantId: s.organizationId,
        vendorId: document.vendorId,
        attributeSet: s.row!.attributeSet,
        validFrom,
        validTo: document.effectiveTo?.toISOString() ?? null,
        now,
        stagingId: s.row!.id,
        version: s.row!.version,
        rows: s.row!.services.map((line) => ({
          id: line.id,
          canonicalName: line.canonicalName,
          canonicalDescription: line.canonicalDescription,
          category: line.category,
          tier: line.tier,
          tierSlug: line.tierSlug,
          title: line.title,
          pricingContext: line.pricingContext,
          pricingRef: line.pricingRef,
          foundAt: line.meta.foundAt,
          attributes: line.attributes,
        })),
      });
    // Edit mode: the new nodes are now written current=true — retire each replaced
    // prior node and AMENDS-link it. Same-document supersession the commit Cypher
    // deliberately skips. FATAL on failure, like the commit above.
    if (s.amendments.length > 0)
      await this.serviceGraph.amendServices({
        tenantId: s.organizationId,
        validFrom,
        now,
        amendments: s.amendments,
      });
    return { ...s, canonicalCount, serviceCount };
  }

  /** staging.markCommitted — flip the staged row AND the doc COMMITTED in one tx. */
  async markCommitted(s: CommitState): Promise<CommitState> {
    await this.staging.markCommitted(s.row!);
    this.logger.log(
      `committed doc=${s.documentId} v${s.row!.version} services=${s.serviceCount} canonicals=${s.canonicalCount}`,
    );
    return s;
  }

  private toResult(s: CommitState): SaveServicesResultDto {
    // Committing one file does NOT touch the vendor's other in-review docs — a
    // reviewer can work through multiple files independently. Overlapping rates
    // are superseded per-service by the commit's amendment chain in the graph.
    return {
      documentId: s.documentId,
      version: s.row!.version,
      canonicalCount: s.canonicalCount,
      serviceCount: s.serviceCount,
      status: DOCUMENT_STATUSES.COMMITTED,
    };
  }
}
