import { Injectable, Logger } from '@nestjs/common';
import type { Record as Neo4jRecord } from 'neo4j-driver';
import { Neo4jService, int } from '@nom/neo4j';
import type { DocumentType, RuleCategory } from '@nom/shared';
import {
  APPLIED_RULES_CYPHER,
  CREATE_RULE_CYPHER,
  DELETE_RULE_CYPHER,
  LIST_RULES_CYPHER,
  RULES_FOR_CATEGORY_CYPHER,
  RULES_FOR_CATEGORY_SEARCH_CYPHER,
  SEARCH_RULES_CYPHER,
  UPDATE_RULE_CYPHER,
  markRulesAppliedCypher,
} from './cypher/rule-graph.cypher';
import { DOCUMENT_GRAPH_LABELS } from './graph-labels';
import { getNullableString, getString } from './graph-record';
import { sanitizeLuceneQuery } from './lucene';
import { GraphWriteError } from './graph-error';

// A rule as returned to the CRUD surface.
export interface RuleRecord {
  id: string;
  title: string;
  category: RuleCategory;
  content: string;
  createdAt: string;
  updatedAt: string;
}

// The lean shape a phase needs to compose its prompt block.
export interface RuleForPrompt {
  id: string;
  title: string;
  content: string;
}

// A rule applied to a document during a phase (audit read-back).
export interface AppliedRule extends RuleRecord {
  phase: string;
  at: string;
}

export interface WriteRuleInput {
  id: string;
  title: string;
  category: RuleCategory;
  content: string;
}

// Fulltext relevance search caps — keep a huge rule set from being shipped whole.
const RULE_SEARCH_TOP_K = 20;

// Vendor-scoped :Rule nodes (guardrails) + the RULED_BY tracking edge from a document.
// Ownership is by indexed vendorId/tenantId props (the CanonicalService pattern), not an
// edge. Reads return [] for an unknown vendor without touching the graph.
@Injectable()
export class RuleGraphRepository {
  private readonly logger = new Logger(RuleGraphRepository.name);

  constructor(private readonly neo4j: Neo4jService) {}

  async listForVendor(
    tenantId: string,
    vendorId: string,
    search?: string,
  ): Promise<RuleRecord[]> {
    const query = search ? sanitizeLuceneQuery(search) : '';
    const records = query
      ? await this.neo4j.read(SEARCH_RULES_CYPHER, {
          vendorId,
          tenantId,
          query,
          topK: int(RULE_SEARCH_TOP_K),
        })
      : await this.neo4j.read(LIST_RULES_CYPHER, { vendorId, tenantId });
    return records.map((r) => this.toRecord(r));
  }

  async create(
    tenantId: string,
    vendorId: string,
    input: WriteRuleInput,
    now: string,
  ): Promise<RuleRecord> {
    const records = await this.neo4j.write(CREATE_RULE_CYPHER, {
      id: input.id,
      tenantId,
      vendorId,
      title: input.title,
      category: input.category,
      content: input.content,
      now,
    });
    const rec = records[0];
    if (!rec) throw new GraphWriteError('Rule create returned no result');
    return this.toRecord(rec);
  }

  // Partial update — absent fields (null) are left unchanged (coalesce in cypher).
  // Returns null when the id doesn't belong to this vendor.
  async update(
    tenantId: string,
    vendorId: string,
    id: string,
    input: Partial<WriteRuleInput>,
    now: string,
  ): Promise<RuleRecord | null> {
    const records = await this.neo4j.write(UPDATE_RULE_CYPHER, {
      id,
      tenantId,
      vendorId,
      title: input.title ?? null,
      category: input.category ?? null,
      content: input.content ?? null,
      now,
    });
    const rec = records[0];
    return rec ? this.toRecord(rec) : null;
  }

  // Returns true when a rule was deleted, false when the id didn't match this vendor.
  async delete(
    tenantId: string,
    vendorId: string,
    id: string,
  ): Promise<boolean> {
    const records = await this.neo4j.write(DELETE_RULE_CYPHER, {
      id,
      tenantId,
      vendorId,
    });
    return records.length > 0;
  }

  async findForCategory(
    tenantId: string,
    vendorId: string,
    category: RuleCategory,
  ): Promise<RuleForPrompt[]> {
    const records = await this.neo4j.read(RULES_FOR_CATEGORY_CYPHER, {
      vendorId,
      tenantId,
      category,
    });
    return records.map((r) => this.toPromptRule(r));
  }

  // Lucene relevance pre-filter for one phase — used when a vendor has more rules than
  // fit a prompt. Returns [] for an empty sanitized query (no graph round-trip).
  async searchRules(
    tenantId: string,
    vendorId: string,
    category: RuleCategory,
    queryText: string,
    topK: number,
  ): Promise<RuleForPrompt[]> {
    const query = sanitizeLuceneQuery(queryText);
    if (!query) return [];
    const records = await this.neo4j.read(RULES_FOR_CATEGORY_SEARCH_CYPHER, {
      vendorId,
      tenantId,
      category,
      query,
      topK: int(topK),
    });
    return records.map((r) => this.toPromptRule(r));
  }

  // Record which rules a phase applied to a document. Best-effort by contract — the
  // caller logs and continues; tracking must never fail a pipeline run. No-op for an
  // empty rule set or an untracked document type.
  async markApplied(input: {
    tenantId: string;
    documentId: string;
    documentType: DocumentType;
    ruleIds: string[];
    phase: string;
    at: string;
  }): Promise<void> {
    if (input.ruleIds.length === 0) return;
    const label = DOCUMENT_GRAPH_LABELS[input.documentType];
    if (!label) return;
    await this.neo4j.write(markRulesAppliedCypher(label), {
      tenantId: input.tenantId,
      documentId: input.documentId,
      ruleIds: input.ruleIds,
      phase: input.phase,
      at: input.at,
    });
  }

  async appliedForDocument(
    tenantId: string,
    documentId: string,
  ): Promise<AppliedRule[]> {
    const records = await this.neo4j.read(APPLIED_RULES_CYPHER, {
      documentId,
      tenantId,
    });
    return records.map((r) => ({
      ...this.toRecord(r),
      phase: getString(r, 'phase'),
      at: getString(r, 'at'),
    }));
  }

  private toRecord(r: Neo4jRecord): RuleRecord {
    return {
      id: getString(r, 'id'),
      title: getString(r, 'title'),
      category: getString(r, 'category') as RuleCategory,
      content: getString(r, 'content'),
      createdAt: getString(r, 'createdAt'),
      updatedAt: getNullableString(r, 'updatedAt') ?? getString(r, 'createdAt'),
    };
  }

  private toPromptRule(r: Neo4jRecord): RuleForPrompt {
    return {
      id: getString(r, 'id'),
      title: getString(r, 'title'),
      content: getString(r, 'content'),
    };
  }
}
