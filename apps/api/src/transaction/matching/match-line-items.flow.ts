import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  DOCUMENT_STATUSES,
  LINE_ITEM_MATCH_KINDS,
  LINE_ITEM_STATUSES,
  RULE_CATEGORIES,
} from '@nom/shared';
import type { DocumentMetadata } from '@nom/shared';
import type { MatchLineItemsResultDto } from '@nom/dtos';
import { resolveBilledAmount, type AttributeSet } from '../../attribute-set';
import { DocumentContextLoader } from '../../shared-loading/document-context.loader';
import {
  LineItemGraphRepository,
  type DocumentLineItem,
} from '../../infra/graph/line-item-graph.repository';
import {
  CanonicalRegistryRepository,
  type CanonicalRegistryEntry,
  type TierRegistryEntry,
} from '../../infra/graph/canonical-registry.repository';
import {
  ServiceGraphRepository,
  type CanonicalServiceGroup,
  type PricingRefEdge,
} from '../../infra/graph/service-graph.repository';
import { renderRateCardCluster } from '../schemas/line-item-schema';
import {
  LineItemMatcher,
  type LineItemMatchResults,
} from './line-item-matcher';
import {
  SymbolResolver,
  type ResolvableLine,
  type ResolvedRow,
} from './symbol-resolver';
import {
  SiblingSymbolResolver,
  type SiblingReference,
  type SiblingResolvableLine,
} from './sibling-symbol-resolver';
import {
  ReferencedExpressionComposer,
  type ComposableLine,
  type ComposeReference,
} from './referenced-expression-composer';
import {
  AmountReconciler,
  type ReconcilableLine,
  type ReconciledRow,
} from './amount-reconciler';
import { NarrativeGenerator, type NarratableLine } from './narrative-generator';
import { logEntry } from '../audit-log';
import { PipelineLogRepository } from '../persistence/pipeline-log.repository';
import { PipelineReasoningRepository } from '../persistence/pipeline-reasoning.repository';
import { RulesService } from '../../rules/rules.service';

/**
 * State threaded through every step of the match flow — each facade method returns an
 * updated copy (the LangGraph node shape `(state) => state`). Fields are filled
 * progressively; `run` guarantees a step's inputs are set before it reads them.
 */
export interface MatchState {
  readonly organizationId: string;
  readonly documentId: string;
  vendorId: string;
  attributeSet: AttributeSet | null;
  metadata: DocumentMetadata;
  rules: string | undefined;
  lineItems: DocumentLineItem[];
  // null = the whole document; a set = a single-line rerun scoped to those ids.
  targetLineItemIds: Set<string> | null;
  registry: CanonicalRegistryEntry[];
  tiers: TierRegistryEntry[];
  matchResults: LineItemMatchResults | null;
  groupedServices: CanonicalServiceGroup[];
  // Cross-service pricing dependencies (PRICED_FROM) reachable from the matched
  // canonicals — the transitive closure the composer needs; empty when no matched
  // service is priced from another.
  pricingRefEdges: PricingRefEdge[];
  resolved: ResolvedRow[];
  reconciled: ReconciledRow[];
  // Reviewer-facing prose per diverging line; empty for match lines and on failure
  // (the DTO layer falls back to its deterministic template).
  narratives: Map<string, string>;
}

/**
 * Reconcile a committed document's line items against the vendor's rate card, phase by
 * phase. Each method is a thin facade over ONE injected collaborator (SRP); `run`
 * composes them and owns the only control flow. Split out of TransactionService so the
 * steps stay uniform and portable — a future LangGraph graph maps 1:1 onto them.
 */
/**
 * Depth cap on the PRICED_FROM traversal at rate-card load — a referencing chain deeper
 * than this (or a cycle the visited-set doesn't already stop) is bounded here. Rate-card
 * reference chains are shallow (B→A→base); this is a safety backstop, not a real limit.
 */
const MAX_PRICING_REF_DEPTH = 5;

@Injectable()
export class TransactionMatchFlow {
  private readonly logger = new Logger(TransactionMatchFlow.name);

  constructor(
    private readonly loader: DocumentContextLoader,
    private readonly matcher: LineItemMatcher,
    private readonly resolver: SymbolResolver,
    private readonly siblingResolver: SiblingSymbolResolver,
    private readonly composer: ReferencedExpressionComposer,
    private readonly reconciler: AmountReconciler,
    private readonly narrativeGenerator: NarrativeGenerator,
    private readonly lineItemGraph: LineItemGraphRepository,
    private readonly canonicalRegistry: CanonicalRegistryRepository,
    private readonly serviceGraph: ServiceGraphRepository,
    private readonly pipelineLog: PipelineLogRepository,
    private readonly pipelineReasoning: PipelineReasoningRepository,
    private readonly rulesService: RulesService,
  ) {}

  async run(
    organizationId: string,
    documentId: string,
  ): Promise<MatchLineItemsResultDto> {
    return this.execute(this.seed(organizationId, documentId));
  }

  /**
   * Re-run matching for ONE line only (a reviewer submitted guidance and retriggered).
   * Reuses the same step composition — every phase operates on the targeted subset, so
   * only that line's graph state is rewritten; the rest of the document is untouched.
   * All lines are still loaded so a targeted line's sibling references can resolve.
   */
  async runForLine(
    organizationId: string,
    documentId: string,
    lineItemId: string,
  ): Promise<MatchLineItemsResultDto> {
    return this.execute(
      this.seed(organizationId, documentId, new Set([lineItemId])),
    );
  }

  private async execute(seed: MatchState): Promise<MatchLineItemsResultDto> {
    let s = seed;
    s = await this.loadDocument(s);
    s = await this.loadLineItems(s);
    if (this.targets(s).length === 0) return this.toResult(s);
    s = await this.loadRules(s);
    s = await this.loadRegistry(s);
    s = await this.adjudicate(s);
    s = await this.persistMatches(s);
    if (s.matchResults!.serviceMatches.length > 0)
      s = await this.loadRateCard(s);
    // Runs even with no service match: an unmatched line whose guidance/rules state its
    // pricing can still resolve its symbols (resolver early-returns when nothing is eligible).
    s = await this.resolveSymbols(s);
    // Only runs when a matched service is priced from another (pricingRefEdges non-empty);
    // rewrites those lines' formulas to compose the chain, over the rate-card rows.
    if (s.pricingRefEdges.length > 0)
      s = await this.composeReferencedExpressions(s);
    s = await this.resolveSiblingSymbols(s);
    if (s.resolved.length > 0) s = await this.persistResolved(s);
    s = this.reconcileAmounts(s);
    s = await this.generateNarratives(s);
    s = await this.persistReconciliation(s);
    return this.toResult(s);
  }

  private seed(
    organizationId: string,
    documentId: string,
    targetLineItemIds: Set<string> | null = null,
  ): MatchState {
    return {
      organizationId,
      documentId,
      vendorId: '',
      attributeSet: null,
      metadata: { isFinancial: false, attributeSet: null },
      rules: undefined,
      lineItems: [],
      targetLineItemIds,
      registry: [],
      tiers: [],
      matchResults: null,
      groupedServices: [],
      pricingRefEdges: [],
      resolved: [],
      reconciled: [],
      narratives: new Map(),
    };
  }

  // The line items this run should (re)adjudicate: the whole document, or — for a
  // single-line rerun — only the targeted ids. Empty when the target isn't in the doc.
  private targets(s: MatchState): DocumentLineItem[] {
    return s.targetLineItemIds
      ? s.lineItems.filter((li) => s.targetLineItemIds!.has(li.id))
      : s.lineItems;
  }

  // Narrow a whole-section adjudication down to the targeted line(s): keep only their
  // rows, their service matches, and the references originating from them (targets may
  // still point OUT to untargeted siblings, which the downstream resolver reads from the
  // fully-loaded section). No-op when there is no target set (whole-doc run).
  private scopeToTargets(
    r: LineItemMatchResults,
    s: MatchState,
  ): LineItemMatchResults {
    const ids = s.targetLineItemIds;
    if (!ids) return r;
    const rows = r.rows.filter((row) => ids.has(row.id));
    return {
      rows,
      serviceMatches: r.serviceMatches.filter((m) => ids.has(m.lineItemId)),
      references: r.references.filter((ref) => ids.has(ref.fromId)),
      counts: {
        serviceMatch: rows.filter(
          (row) => row.matchKind === LINE_ITEM_MATCH_KINDS.SERVICE_MATCH,
        ).length,
        siblingRef: rows.filter(
          (row) => row.matchKind === LINE_ITEM_MATCH_KINDS.SIBLING_REF,
        ).length,
        unmatched: rows.filter(
          (row) => row.matchKind === LINE_ITEM_MATCH_KINDS.UNMATCHED,
        ).length,
      },
    };
  }

  /**
   * loader.loadTransactionDoc — load the doc + attribute set, gate on COMMITTED before
   * any graph read.
   */
  async loadDocument(s: MatchState): Promise<MatchState> {
    this.logger.log(`match line-items start doc=${s.documentId}`);
    const { document, set } = await this.loader.loadTransactionDoc(
      s.organizationId,
      s.documentId,
    );
    // Allow a committed doc (first match), plus a background job already flipped to
    // MATCHING, and a re-match of an already-MATCHED doc.
    const matchable: string[] = [
      DOCUMENT_STATUSES.COMMITTED,
      DOCUMENT_STATUSES.MATCHING,
      DOCUMENT_STATUSES.MATCHED,
    ];
    if (!matchable.includes(document.status))
      throw new BadRequestException(
        `Line items must be extracted before matching (status=${document.status})`,
      );
    return {
      ...s,
      attributeSet: set,
      vendorId: document.vendorId ?? '',
      metadata: document.metadata,
    };
  }

  /**
   * The committed line items to reconcile. A whole-doc run loads all of them; a
   * single-line rerun loads only the target's invoice section (its sibling boundary), so
   * a targeted sibling_ref can still resolve its references against the section.
   */
  async loadLineItems(s: MatchState): Promise<MatchState> {
    const lineItems = s.targetLineItemIds
      ? await this.lineItemGraph.listForSectionOf(
          s.organizationId,
          s.documentId,
          [...s.targetLineItemIds][0],
        )
      : await this.lineItemGraph.listForDocument(
          s.organizationId,
          s.documentId,
        );
    return { ...s, lineItems };
  }

  /**
   * rulesService.rulesFor — the vendor's matching rules for this document, narrowed by
   * relevance to the line descriptions. Resolved after the line items load so the
   * relevance query has real context; every LLM phase reads s.rules. Records which
   * rules were applied (best-effort). No-op for a vendorless doc.
   */
  async loadRules(s: MatchState): Promise<MatchState> {
    if (!s.vendorId) return s;
    const selected = await this.rulesService.rulesFor(
      s.organizationId,
      s.vendorId,
      RULE_CATEGORIES.MATCHING_RECONCILIATION,
      this.targets(s)
        .map((li) => li.description)
        .join(' '),
    );
    if (!selected) return s;
    await this.rulesService.markRulesApplied({
      tenantId: s.organizationId,
      documentId: s.documentId,
      documentType: s.attributeSet!.documentType,
      category: RULE_CATEGORIES.MATCHING_RECONCILIATION,
      ruleIds: selected.ruleIds,
    });
    return { ...s, rules: selected.text };
  }

  /** canonicalRegistry — the vendor's canonical services + known tier slugs. */
  async loadRegistry(s: MatchState): Promise<MatchState> {
    const [registry, tiers] = await Promise.all([
      this.canonicalRegistry.findForVendor(s.organizationId, s.vendorId),
      this.canonicalRegistry.tiersForVendor(s.organizationId, s.vendorId),
    ]);
    return { ...s, registry, tiers };
  }

  /**
   * matcher.match — adjudicate each line (service_match / sibling_ref / unmatched). The
   * whole loaded set is sent to the model so a targeted sibling_ref sees its section-mates
   * in the table and can resolve its references; the verdict is then scoped back to the
   * targeted line(s) so a single-line rerun only rewrites that line (scopeToTargets is a
   * no-op for a whole-doc run, where the targets ARE the whole set).
   */
  async adjudicate(s: MatchState): Promise<MatchState> {
    const full = await this.matcher.match(
      s.attributeSet!,
      s.lineItems,
      s.registry,
      s.tiers,
      s.organizationId,
      s.vendorId,
      s.documentId,
      s.metadata,
      s.rules,
    );
    const matchResults = this.scopeToTargets(full, s);
    const c = matchResults.counts;
    this.logger.log(
      `matched doc=${s.documentId} service=${c.serviceMatch} sibling=${c.siblingRef} unmatched=${c.unmatched}`,
    );
    // Apply the adjudicator's accepted formula/symbols back onto the line items so the
    // resolve + reconcile phases (which read li.formula / li.symbols) see any correction.
    const acceptedById = new Map(matchResults.rows.map((r) => [r.id, r]));
    const lineItems = s.lineItems.map((li) => {
      const r = acceptedById.get(li.id);
      return r ? { ...li, formula: r.formula, symbols: r.symbols } : li;
    });
    return { ...s, matchResults, lineItems };
  }

  /**
   * lineItemGraph.writeMatchResults — persist matchKind + BILLED_AS / REFERENCES edges to
   * the graph; the audit log and match reasoning go to Postgres (pipeline_logs /
   * pipeline_reasoning), keyed by line-item id.
   */
  async persistMatches(s: MatchState): Promise<MatchState> {
    const r = s.matchResults!;
    await this.lineItemGraph.writeMatchResults({
      tenantId: s.organizationId,
      vendorId: s.vendorId,
      rows: r.rows.map((row) => ({
        id: row.id,
        matchKind: row.matchKind,
        formula: row.formula,
        symbols: row.symbols === null ? null : JSON.stringify(row.symbols),
      })),
      serviceMatches: r.serviceMatches,
      references: r.references,
    });
    // Both observability writes are best-effort and independent of each other.
    await Promise.all([
      this.pipelineLog.append({
        organizationId: s.organizationId,
        documentId: s.documentId,
        entries: r.rows.map((row) => ({ entityId: row.id, messages: row.log })),
      }),
      this.pipelineReasoning.upsert({
        organizationId: s.organizationId,
        documentId: s.documentId,
        rows: r.rows.map((row) => ({
          entityId: row.id,
          reasoning: row.reasoning,
        })),
      }),
    ]);
    return s;
  }

  /** serviceGraph.listServicesForCanonicals — tiers for the canonicals this doc's lines were BILLED_AS, not the vendor's whole rate card. */
  async loadRateCard(s: MatchState): Promise<MatchState> {
    const canonicalNames = [
      ...new Set(s.matchResults!.serviceMatches.map((m) => m.canonicalName)),
    ];
    // Follow PRICED_FROM one BFS level at a time so a line billed as a referencing
    // service also loads the services it derives from. Cycle-guarded by `reached` and
    // depth-capped — a self-referential rate card can't loop forever.
    const reached = new Set(canonicalNames);
    const pricingRefEdges: PricingRefEdge[] = [];
    let frontier = canonicalNames;
    for (
      let depth = 0;
      depth < MAX_PRICING_REF_DEPTH && frontier.length;
      depth++
    ) {
      const edges = await this.serviceGraph.listPricingRefs(
        s.organizationId,
        s.vendorId,
        frontier,
      );
      const next: string[] = [];
      for (const edge of edges) {
        pricingRefEdges.push(edge);
        if (!reached.has(edge.referencedCanonical)) {
          reached.add(edge.referencedCanonical);
          next.push(edge.referencedCanonical);
        }
      }
      frontier = next;
    }

    const groupedServices = await this.serviceGraph.listServicesForCanonicals(
      s.organizationId,
      s.vendorId,
      [...reached],
    );
    return { ...s, groupedServices, pricingRefEdges };
  }

  /**
   * resolver.resolve — fill the null formula symbols of the service-matched lines from
   * the rate card, plus the symbols of unmatched lines whose pricing is stated in the
   * reviewer's guidance or the vendor rules (no rate-card service, so resolved purely
   * from those sources). Guidance may also correct a wrong extracted value.
   */
  async resolveSymbols(s: MatchState): Promise<MatchState> {
    const byId = new Map(s.lineItems.map((li) => [li.id, li]));
    const resolvable: ResolvableLine[] = s
      .matchResults!.serviceMatches.map((sm): ResolvableLine | null => {
        const li = byId.get(sm.lineItemId);
        return li
          ? {
              id: li.id,
              description: li.description,
              canonicalName: sm.canonicalName,
              tierSlug: sm.tierSlug,
              formula: li.formula,
              symbols: li.symbols,
              guidance: li.guidance,
            }
          : null;
      })
      .filter((x): x is ResolvableLine => x !== null);

    // Unmatched lines can still be priced by guidance/rules alone — include those that
    // have a formula and some guidance context to draw a value from.
    for (const row of s.matchResults!.rows) {
      if (row.matchKind !== LINE_ITEM_MATCH_KINDS.UNMATCHED) continue;
      const li = byId.get(row.id);
      if (!li || li.formula === null || (!li.guidance && !s.rules)) continue;
      resolvable.push({
        id: li.id,
        description: li.description,
        canonicalName: null,
        tierSlug: null,
        formula: li.formula,
        symbols: li.symbols,
        guidance: li.guidance,
      });
    }

    if (resolvable.length === 0) return s;
    const resolved = await this.resolver.resolve(
      s.attributeSet!,
      resolvable,
      renderRateCardCluster(s.groupedServices),
      s.organizationId,
      s.documentId,
      s.rules,
    );
    return { ...s, resolved };
  }

  /**
   * composer.compose — for lines billed as a service that is PRICED_FROM another, rewrite
   * the formula to encode the dependency chain and source its symbols from the referenced
   * services' pricingContext + the line's base attribute. Gated: only the lines whose
   * matched canonical starts a pricing-ref chain enter it. The composed rows REPLACE the
   * rate-card resolver's rows for those lines (a referencing line's `rate` never resolves
   * from a single tier), preserving the rate-card provenance in the merged log.
   */
  async composeReferencedExpressions(s: MatchState): Promise<MatchState> {
    const refFrom = new Set(s.pricingRefEdges.map((e) => e.fromCanonical));
    const byId = new Map(s.lineItems.map((li) => [li.id, li]));

    const composable: ComposableLine[] = s
      .matchResults!.serviceMatches.filter((m) => refFrom.has(m.canonicalName))
      .map((m): ComposableLine | null => {
        const li = byId.get(m.lineItemId);
        if (!li || li.formula === null) return null;
        return {
          id: li.id,
          description: li.description,
          canonicalName: m.canonicalName,
          formula: li.formula,
          symbols: li.symbols,
          attributes: li.attributes,
          references: this.referenceChain(m.canonicalName, s.pricingRefEdges),
        };
      })
      .filter((x): x is ComposableLine => x !== null);

    if (composable.length === 0) return s;
    const composed = await this.composer.compose(
      s.attributeSet!,
      composable,
      renderRateCardCluster(s.groupedServices),
      s.organizationId,
      s.documentId,
      s.rules,
    );

    // Merge composed rows over the rate-card rows by id, concatenating audit logs.
    const composedById = new Map(composed.map((r) => [r.id, r]));
    const resolved = s.resolved.map((r) => {
      const c = composedById.get(r.id);
      if (!c) return r;
      composedById.delete(r.id);
      return {
        id: r.id,
        formula: c.formula,
        symbols: c.symbols,
        logAdditions: [...r.logAdditions, ...c.logAdditions],
      };
    });
    // A composed line with no prior rate-card row (unusual) is appended as-is.
    for (const c of composedById.values()) resolved.push(c);
    this.logger.log(
      `composed referenced formulas for ${composed.length} line(s) doc=${s.documentId}`,
    );
    return { ...s, resolved };
  }

  // The PRICED_FROM edges reachable from a billed canonical — the chain the composer
  // needs to express one line's price. BFS over the loaded edge set, cycle-guarded.
  private referenceChain(
    from: string,
    edges: ComposeReference[],
  ): ComposeReference[] {
    const chain: ComposeReference[] = [];
    const seen = new Set<string>([from]);
    let frontier = [from];
    while (frontier.length) {
      const next: string[] = [];
      for (const edge of edges) {
        if (!frontier.includes(edge.fromCanonical)) continue;
        chain.push(edge);
        if (!seen.has(edge.referencedCanonical)) {
          seen.add(edge.referencedCanonical);
          next.push(edge.referencedCanonical);
        }
      }
      frontier = next;
    }
    return chain;
  }

  /**
   * siblingResolver.resolve — fill the null formula symbols of sibling_ref lines from
   * their referenced siblings' billed amounts. No-op when the matcher wrote no
   * REFERENCES edges. Appends to `resolved` alongside the rate-card resolver's rows.
   */
  async resolveSiblingSymbols(s: MatchState): Promise<MatchState> {
    const refs = s.matchResults!.references;
    if (refs.length === 0) return s;
    const byId = new Map(s.lineItems.map((li) => [li.id, li]));

    const refsByFrom = new Map<string, SiblingReference[]>();
    for (const { fromId, toId } of refs) {
      const sib = byId.get(toId);
      if (!sib) continue;
      const list = refsByFrom.get(fromId) ?? [];
      list.push({
        id: sib.id,
        description: sib.description,
        billedAmount: resolveBilledAmount(s.attributeSet!, sib.attributes),
      });
      refsByFrom.set(fromId, list);
    }

    const resolvable: SiblingResolvableLine[] = [...refsByFrom.entries()]
      .map(([fromId, references]) => {
        const li = byId.get(fromId);
        return li
          ? {
              id: li.id,
              description: li.description,
              formula: li.formula,
              symbols: li.symbols,
              references,
            }
          : null;
      })
      .filter((x): x is SiblingResolvableLine => x !== null);

    const rows = await this.siblingResolver.resolve(
      s.attributeSet!,
      resolvable,
      s.organizationId,
      s.documentId,
      s.rules,
    );
    this.logger.log(
      `resolved sibling symbols for ${rows.length} line(s) doc=${s.documentId}`,
    );
    return { ...s, resolved: [...s.resolved, ...rows] };
  }

  /**
   * lineItemGraph.writeResolvedSymbols — persist resolved symbols to the graph; the
   * resolution provenance is appended to Postgres pipeline_logs.
   */
  async persistResolved(s: MatchState): Promise<MatchState> {
    await this.lineItemGraph.writeResolvedSymbols({
      tenantId: s.organizationId,
      rows: s.resolved.map((r) => ({
        id: r.id,
        symbols: r.symbols === null ? null : JSON.stringify(r.symbols),
        formula: r.formula,
      })),
    });
    await this.pipelineLog.append({
      organizationId: s.organizationId,
      documentId: s.documentId,
      entries: s.resolved.map((r) => ({
        entityId: r.id,
        messages: r.logAdditions,
      })),
    });
    this.logger.log(
      `resolved symbols for ${s.resolved.length} line(s) doc=${s.documentId}`,
    );
    return s;
  }

  /**
   * reconciler.reconcile — evaluate each resolved line's formula and verdict expected
   * vs billed. Lines with no resolved row (unmatched, sibling_ref downgraded for lack
   * of valid references) are verdicted needs_review directly, so every line leaves the
   * flow with a status.
   */
  reconcileAmounts(s: MatchState): MatchState {
    const byId = new Map(s.lineItems.map((li) => [li.id, li]));
    const reconcilable: ReconcilableLine[] = s.resolved
      .map((r) => {
        const li = byId.get(r.id);
        return li
          ? {
              id: li.id,
              // The composer may have rewritten the formula to a referenced chain; prefer
              // it over the line's original formula. Every other resolver leaves it unset.
              formula: r.formula ?? li.formula,
              symbols: r.symbols,
              attributes: li.attributes,
            }
          : null;
      })
      .filter((x): x is ReconcilableLine => x !== null);

    const reconciled = this.reconciler.reconcile(s.attributeSet!, reconcilable);

    const kindById = new Map(
      (s.matchResults?.rows ?? []).map((r) => [r.id, r.matchKind]),
    );
    const resolvedIds = new Set(s.resolved.map((r) => r.id));
    // Only the adjudicated lines get a verdict — a single-line rerun must not reset
    // every other line to needs_review.
    for (const li of this.targets(s)) {
      if (resolvedIds.has(li.id)) continue;
      const isSibling =
        kindById.get(li.id) === LINE_ITEM_MATCH_KINDS.SIBLING_REF;
      reconciled.push({
        id: li.id,
        status: LINE_ITEM_STATUSES.NEEDS_REVIEW,
        expectedAmount: null,
        billedAmount: resolveBilledAmount(s.attributeSet!, li.attributes),
        reviewNote: isSibling
          ? `Needs context: references not identified${li.initialRefSummary ? ` ("${li.initialRefSummary}")` : ''}`
          : 'Needs context: no rate-card service matched',
        logAdditions: [
          logEntry(
            'No rate-card match or sibling reference — marked needs review.',
          ),
        ],
      });
    }
    return { ...s, reconciled };
  }

  /**
   * narrativeGenerator.generate — author a reviewer-facing narrative for each diverging
   * line (mismatch / needs_review); clean matches keep the DTO-layer template. Fail-soft:
   * narrative is non-essential and must never block the (fatal) reconciliation write, so
   * any error leaves `narratives` empty and each line's narrative falls back to null.
   */
  async generateNarratives(s: MatchState): Promise<MatchState> {
    const byId = new Map(s.lineItems.map((li) => [li.id, li]));
    const diverging: NarratableLine[] = s.reconciled
      .filter((r) => r.status !== LINE_ITEM_STATUSES.MATCH)
      .map((r) => {
        const li = byId.get(r.id);
        return li
          ? {
              id: r.id,
              description: li.description,
              status: r.status,
              formula: li.formula,
              symbols: li.symbols,
              expectedAmount: r.expectedAmount,
              billedAmount: r.billedAmount,
              reviewNote: r.reviewNote,
              matchedPricingContext: li.matchedPricingContext,
              matchedServiceAttributes: li.matchedServiceAttributes,
              attributes: li.attributes,
            }
          : null;
      })
      .filter((x): x is NarratableLine => x !== null);

    try {
      const narratives = await this.narrativeGenerator.generate(
        s.attributeSet!,
        diverging,
        s.metadata.vendorName ?? null,
        s.organizationId,
        s.documentId,
        s.rules,
      );
      return { ...s, narratives };
    } catch (err) {
      this.logger.warn(
        `narrative generation failed doc=${s.documentId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return s;
    }
  }

  /**
   * lineItemGraph.writeReconciliation — persist review status + amounts + note to the
   * graph; the expected-vs-billed provenance is appended to Postgres pipeline_logs.
   */
  async persistReconciliation(s: MatchState): Promise<MatchState> {
    await this.lineItemGraph.writeReconciliation({
      tenantId: s.organizationId,
      rows: s.reconciled.map((r) => ({
        id: r.id,
        status: r.status,
        expectedAmount: r.expectedAmount,
        billedAmount: r.billedAmount,
        reviewNote: r.reviewNote,
        narrative: s.narratives.get(r.id) ?? null,
      })),
    });
    await this.pipelineLog.append({
      organizationId: s.organizationId,
      documentId: s.documentId,
      entries: s.reconciled.map((r) => ({
        entityId: r.id,
        messages: r.logAdditions,
      })),
    });
    this.logger.log(
      `reconciled ${s.reconciled.length} line(s) doc=${s.documentId}`,
    );
    return s;
  }

  private toResult(s: MatchState): MatchLineItemsResultDto {
    const c = s.matchResults?.counts;
    return {
      documentId: s.documentId,
      serviceMatchCount: c?.serviceMatch ?? 0,
      siblingRefCount: c?.siblingRef ?? 0,
      unmatchedCount: c?.unmatched ?? 0,
    };
  }
}
