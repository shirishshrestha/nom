import { randomUUID } from 'node:crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VendorEntity } from '@nom/database';
import type { DocumentType, RuleCategory } from '@nom/shared';
import { CreateRuleDto, UpdateRuleDto } from '@nom/dtos';
import {
  RuleGraphRepository,
  type RuleRecord,
} from '../infra/graph/rule-graph.repository';
import type { OrgSession } from '../auth/auth.types.js';

// The first N rules of a (vendor, category) are the pinned core — always injected, in
// creation order. Beyond that, the overflow is narrowed to a Lucene top-K by relevance so
// a long tail of niche rules never floods the prompt (max N + K rules reach it).
const RULES_PINNED_CORE = 10;
const RULES_OVERFLOW_TOP_K = 10;

// The rules selected for a phase: the composed prompt text plus the ids that produced
// it (for RULED_BY application tracking).
export interface SelectedRules {
  text: string;
  ruleIds: string[];
}

@Injectable()
export class RulesService {
  private readonly logger = new Logger(RulesService.name);

  constructor(
    @InjectRepository(VendorEntity)
    private readonly vendorsRepo: Repository<VendorEntity>,
    private readonly rules: RuleGraphRepository,
  ) {}

  async list(
    session: OrgSession,
    vendorId: string,
    search?: string,
  ): Promise<RuleRecord[]> {
    const organizationId = await this.assertVendor(session, vendorId);
    return this.rules.listForVendor(organizationId, vendorId, search);
  }

  async create(
    session: OrgSession,
    vendorId: string,
    dto: CreateRuleDto,
  ): Promise<RuleRecord> {
    const organizationId = await this.assertVendor(session, vendorId);
    const rule = await this.rules.create(
      organizationId,
      vendorId,
      { id: randomUUID(), ...dto },
      new Date().toISOString(),
    );
    this.logger.log(`created rule=${rule.id} vendor=${vendorId}`);
    return rule;
  }

  async update(
    session: OrgSession,
    vendorId: string,
    id: string,
    dto: UpdateRuleDto,
  ): Promise<RuleRecord> {
    const organizationId = await this.assertVendor(session, vendorId);
    const rule = await this.rules.update(
      organizationId,
      vendorId,
      id,
      dto,
      new Date().toISOString(),
    );
    if (!rule) throw new NotFoundException('Rule not found');
    return rule;
  }

  async remove(
    session: OrgSession,
    vendorId: string,
    id: string,
  ): Promise<void> {
    const organizationId = await this.assertVendor(session, vendorId);
    const deleted = await this.rules.delete(organizationId, vendorId, id);
    if (!deleted) throw new NotFoundException('Rule not found');
  }

  // Internal: the rules to inject into one phase's prompt for a vendor. Size-gated
  // like the registry pre-filter — below the threshold take all, above it narrow to a
  // Lucene top-K over the phase's `contextText`. Returns undefined when there are none
  // (so renderRulesBlock stays a no-op). No org check — callers already hold a
  // vendor-scoped document from the pipeline.
  async rulesFor(
    tenantId: string,
    vendorId: string,
    category: RuleCategory,
    contextText: string,
  ): Promise<SelectedRules | undefined> {
    const all = await this.rules.findForCategory(tenantId, vendorId, category);
    if (all.length === 0) return undefined;

    // ponytail: first-N pinned + relevance-picked overflow — raise N or swap for semantic
    // search if a vendor's core alone ever outgrows the prompt.
    let selected = all;
    if (all.length > RULES_PINNED_CORE) {
      const pinned = all.slice(0, RULES_PINNED_CORE);
      const pinnedIds = new Set(pinned.map((r) => r.id));
      // Relevance ranks the whole set; keep only overflow hits (search can't offset), capped.
      const hits = await this.rules.searchRules(
        tenantId,
        vendorId,
        category,
        contextText,
        RULES_PINNED_CORE + RULES_OVERFLOW_TOP_K,
      );
      const overflow = hits
        .filter((h) => !pinnedIds.has(h.id))
        .slice(0, RULES_OVERFLOW_TOP_K);
      selected = [...pinned, ...overflow];
    }

    const text = selected.map((r) => `- ${r.title}: ${r.content}`).join('\n');
    return { text, ruleIds: selected.map((r) => r.id) };
  }

  // Record which rules a phase applied to a document (RULED_BY tracking edge).
  // Best-effort — tracking must never fail a pipeline run.
  async markRulesApplied(input: {
    tenantId: string;
    documentId: string;
    documentType: DocumentType;
    category: RuleCategory;
    ruleIds: string[];
  }): Promise<void> {
    try {
      await this.rules.markApplied({
        tenantId: input.tenantId,
        documentId: input.documentId,
        documentType: input.documentType,
        ruleIds: input.ruleIds,
        phase: input.category,
        at: new Date().toISOString(),
      });
    } catch (e) {
      this.logger.warn(
        `rule tracking failed doc=${input.documentId} phase=${input.category}: ${(e as Error).message}`,
      );
    }
  }

  // The vendor is the org-scoped source of truth (Postgres); a rule can only be
  // created/read under a vendor the caller's org owns. Returns the organizationId.
  private async assertVendor(
    session: OrgSession,
    vendorId: string,
  ): Promise<string> {
    const organizationId = session.session.activeOrganizationId;
    const vendor = await this.vendorsRepo.findOneBy({
      id: vendorId,
      organizationId,
    });
    if (!vendor) throw new NotFoundException('Vendor not found');
    return organizationId;
  }
}
