import { Inject, Injectable, Logger } from '@nestjs/common';
import { LINE_ITEM_MATCH_KINDS, type LineItemMatchKind } from '@nom/shared';
import type { DocumentMetadata } from '@nom/shared';
import type { AttributeSet } from '../../attribute-set';
import { ADJUDICATOR_EXTRACTOR } from '../../infra/llm/llm.tokens';
import type { StructuredExtractor } from '../../infra/llm/structured-extractor.port';
import { promptTag } from '../../infra/llm/prompt.types';
import {
  CanonicalRegistryRepository,
  type CanonicalRegistryEntry,
  type TierRegistryEntry,
} from '../../infra/graph/canonical-registry.repository';
import type { DocumentLineItem } from '../../infra/graph/line-item-graph.repository';
import { normalizeCanonical } from '../../common/canonical';
import { todayISO } from '../../common/registry-render';
import { toTable } from '../../common/prompt-serialize';
import { filterRegistryForBatch } from '../../common/registry-filter';
import { validateExpression } from '../expression/validate-expression';
import { logEntry } from '../audit-log';
import {
  buildMatchSchema,
  LINE_ITEM_MATCH_PROMPT,
  type LineMatch,
  type MatchReasoning,
  type MatchResult,
} from '../schemas/match-schema';

// What the reconciler hands back to TransactionService: the exact payload for
// LineItemGraphRepository.writeMatchResults plus the per-kind counts for the response.
export interface LineItemMatchResults {
  rows: Array<{
    id: string;
    matchKind: LineItemMatchKind;
    reasoning: MatchReasoning; // structured match rationale → Postgres pipeline_reasoning
    log: string[]; // this run's new audit entries → Postgres pipeline_logs
    formula: string | null; // accepted formula (corrected if the model's rewrite validated, else original)
    symbols: Record<string, number | null> | null; // accepted symbol declarations for that formula
  }>;
  serviceMatches: Array<{
    lineItemId: string;
    canonicalName: string;
    tierSlug: string | null;
  }>;
  references: Array<{ fromId: string; toId: string }>;
  counts: { serviceMatch: number; siblingRef: number; unmatched: number };
}

/**
 * Phase 2 — resolves each billed line into a final match against the vendor's rate
 * card, one invoice section at a time. Sibling references are always within a single
 * invoice, so sections are independent and run concurrently (extractMany). Coerces any
 * model output that names a canonical/sibling not actually present to "unmatched", so
 * the downstream graph write never fails an integrity assertion on model drift.
 */
@Injectable()
export class LineItemMatcher {
  private readonly logger = new Logger(LineItemMatcher.name);

  constructor(
    @Inject(ADJUDICATOR_EXTRACTOR)
    private readonly extractor: StructuredExtractor,
    private readonly canonicalRegistry: CanonicalRegistryRepository,
  ) {}

  async match(
    set: AttributeSet,
    lineItems: DocumentLineItem[],
    registry: CanonicalRegistryEntry[],
    tiers: TierRegistryEntry[],
    tenantId: string,
    vendorId: string,
    documentId: string,
    metadata: DocumentMetadata,
    rules?: string,
  ): Promise<LineItemMatchResults> {
    const sections = this.groupByInvoice(lineItems);
    const schema = buildMatchSchema();
    const tag = promptTag(LINE_ITEM_MATCH_PROMPT);
    const known = new Set(registry.map((c) => c.canonicalName));
    // Anchor the current date for reviewer guidance that names a relative range; only
    // needed when guidance is present and no vendor rules already carry the date.
    const today =
      !rules && lineItems.some((l) => l.guidance) ? todayISO() : undefined;

    // Size-gated pre-filter, computed per section up front (extractMany's `build`
    // is synchronous) — below the threshold this is a no-op returning the full sets.
    const filteredPerSection = await Promise.all(
      sections.map((section) =>
        filterRegistryForBatch(
          this.canonicalRegistry,
          tenantId,
          vendorId,
          registry,
          tiers,
          section.map((l) => l.description).join(' '),
          section.map((l) => l.initialCanonical),
        ),
      ),
    );

    const perSection = await this.extractor.extractMany(
      sections,
      (section, i) => ({
        system: LINE_ITEM_MATCH_PROMPT.render({
          set,
          registry: filteredPerSection[i].registry,
          tiers: filteredPerSection[i].tiers,
          metadata,
          rules,
          today,
        }),
        human: toTable(
          section.map((l) => ({
            id: l.id,
            description: l.description,
            sectionContext: l.sectionContext,
            attributes: l.attributes,
            initialKind: l.initialKind,
            initialCanonical: l.initialCanonical,
            initialTierSlug: l.initialTierSlug,
            initialRefSummary: l.initialRefSummary,
            formula: l.formula,
            symbols: l.symbols ?? {},
            // A reviewer's correction for this line — the column is dropped when no line
            // has one (toTable prunes all-empty columns).
            reviewerGuidance: l.guidance,
          })),
        ),
        schema,
        options: {
          operation: tag,
          reference: {
            organizationId: tenantId,
            sourceType: 'document',
            sourceId: documentId,
          },
        },
      }),
      { operation: tag },
    );

    const out: LineItemMatchResults = {
      rows: [],
      serviceMatches: [],
      references: [],
      counts: { serviceMatch: 0, siblingRef: 0, unmatched: 0 },
    };

    sections.forEach((section, i) => {
      const matches = this.validate(perSection[i], section, tag);
      this.reconcileSection(section, matches, known, tag, out);
    });

    return out;
  }

  /**
   * Apply one section's verdicts: build the final log for every line (incl.
   * bidirectional "referenced by" notes on siblings) and collect the edge payloads.
   */
  private reconcileSection(
    section: DocumentLineItem[],
    matches: Map<string, LineMatch>,
    known: Set<string>,
    tag: string,
    out: LineItemMatchResults,
  ): void {
    const descById = new Map(section.map((l) => [l.id, l.description]));
    const idsInSection = new Set(section.map((l) => l.id));
    // This run's NEW audit entries per line — appended to Postgres pipeline_logs, which
    // holds the prior trail (append-only, no read-modify-write). A line already carrying
    // a matchKind was matched in a prior run: stamp a divider so this rematch's entries
    // are distinguishable from the earlier ones.
    const logs = new Map(
      section.map((l) => [
        l.id,
        l.matchKind
          ? [
              logEntry(
                '=== rematch — entries below supersede the earlier match ===',
              ),
            ]
          : [],
      ]),
    );

    // Pass A — each line's own verdict + service-match edges.
    const kindById = new Map(
      section.map((line) => [
        line.id,
        this.classifyLine(
          line,
          matches.get(line.id)!,
          known,
          tag,
          logs.get(line.id)!,
          out,
        ),
      ]),
    );

    // Pass B — sibling reference edges, both directions, now that all kinds are resolved.
    // A sibling line with zero valid edges is downgraded to unmatched so matchKind,
    // counts, and the edge set stay consistent.
    for (const line of section) {
      if (kindById.get(line.id) !== LINE_ITEM_MATCH_KINDS.SIBLING_REF) continue;
      const linked = this.linkSiblings(
        line,
        matches.get(line.id)!,
        idsInSection,
        descById,
        tag,
        logs,
        out,
      );
      if (!linked) kindById.set(line.id, LINE_ITEM_MATCH_KINDS.UNMATCHED);
    }

    // Emit every line's finalised row + tally counts.
    for (const line of section) {
      const matchKind = kindById.get(line.id)!;
      const log = logs.get(line.id)!;
      const { formula, symbols } = this.acceptFormula(
        line,
        matches.get(line.id)!,
        log,
        tag,
      );
      out.rows.push({
        id: line.id,
        matchKind,
        reasoning: matches.get(line.id)!.reasoning,
        log,
        formula,
        symbols,
      });
      if (matchKind === LINE_ITEM_MATCH_KINDS.SERVICE_MATCH)
        out.counts.serviceMatch++;
      else if (matchKind === LINE_ITEM_MATCH_KINDS.SIBLING_REF)
        out.counts.siblingRef++;
      else out.counts.unmatched++;
    }
  }

  /**
   * Pass A — one line's own verdict. Sibling refs are deferred to Pass B (they need
   * every line's kind resolved first); an unknown/empty canonical never fabricates an
   * edge. Pushes the service-match edge + audit log as a side effect; returns the kind.
   */
  private classifyLine(
    line: DocumentLineItem,
    m: LineMatch,
    known: Set<string>,
    tag: string,
    log: string[],
    out: LineItemMatchResults,
  ): LineItemMatchKind {
    // Edges + back-references handled in Pass B.
    if (m.kind === LINE_ITEM_MATCH_KINDS.SIBLING_REF)
      return LINE_ITEM_MATCH_KINDS.SIBLING_REF;

    if (m.kind !== LINE_ITEM_MATCH_KINDS.SERVICE_MATCH) {
      log.push(
        logEntry(
          `Adjudicated as unmatched — no rate-card service or sibling reference fits this line · ${tag}`,
        ),
      );
      return LINE_ITEM_MATCH_KINDS.UNMATCHED;
    }

    const canonical = m.canonicalName
      ? normalizeCanonical(m.canonicalName)
      : '';
    if (!canonical || !known.has(canonical)) {
      // Model named a canonical not in the registry — don't fabricate an edge.
      log.push(
        logEntry(
          `Adjudicated as unmatched — proposed service "${m.canonicalName ?? ''}" is not in the vendor's registry · ${tag}`,
        ),
      );
      return LINE_ITEM_MATCH_KINDS.UNMATCHED;
    }

    const tierSlug = m.tierSlug ? normalizeCanonical(m.tierSlug) || null : null;
    out.serviceMatches.push({
      lineItemId: line.id,
      canonicalName: canonical,
      tierSlug,
    });
    log.push(
      logEntry(
        `Matched to rate-card service "${canonical}"${tierSlug ? ` (tier "${tierSlug}")` : ''} · ${tag}`,
      ),
    );
    return LINE_ITEM_MATCH_KINDS.SERVICE_MATCH;
  }

  /**
   * Pass B — one sibling line's reference edges. A self- or out-of-section id can't be
   * an edge, so those are filtered out; each remaining sibling gets a REFERENCES edge
   * and a bidirectional audit note ("references" here, "referenced by" on the sibling).
   * Returns whether any valid edge was created — false means the caller downgrades
   * the line to unmatched.
   */
  private linkSiblings(
    line: DocumentLineItem,
    m: LineMatch,
    idsInSection: Set<string>,
    descById: Map<string, string>,
    tag: string,
    logs: Map<string, string[]>,
    out: LineItemMatchResults,
  ): boolean {
    const log = logs.get(line.id)!;
    const valid = m.referencedIds.filter(
      (rid) => rid !== line.id && idsInSection.has(rid),
    );

    log.push(
      logEntry(
        valid.length === 0
          ? `Marked as computed from sibling lines, but none could be identified in this invoice — downgraded to unmatched · ${tag}`
          : `Computed from ${valid.length} sibling line(s) in this invoice · ${tag}`,
      ),
    );

    for (const rid of valid) {
      out.references.push({ fromId: line.id, toId: rid });
      log.push(
        logEntry(
          `References sibling "${descById.get(rid) ?? '?'}" (id ${rid})`,
        ),
      );
      // Bidirectional: the referenced sibling records that it was included.
      logs
        .get(rid)!
        .push(
          logEntry(
            `Referenced by sibling "${line.description}" (id ${line.id})`,
          ),
        );
    }
    return valid.length > 0;
  }

  /**
   * Accept or reject the model's formula rewrite. Deterministic guard: the model's
   * formula is only taken when it is well-formed over its own declared symbols
   * (validateExpression) — otherwise the extraction-time formula/symbols are kept, so a
   * bad rewrite can never be persisted. Symbol values PRESERVE the extractor's originals:
   * any symbol the line already declared keeps its extracted value (incl. the reserved
   * `rate`=null that phase 3 fills from the rate card). The adjudicator has less context
   * than extraction (no raw invoice chunk), so it must not overwrite a known value (e.g.
   * flip quantity 163 → 1) — it may only introduce genuinely NEW symbols, whose value it
   * supplies (or null for phase-3 resolution). Declare-only by contract.
   */
  private acceptFormula(
    line: DocumentLineItem,
    m: LineMatch,
    log: string[],
    tag: string,
  ): { formula: string | null; symbols: Record<string, number | null> | null } {
    // Model declined to give a formula — keep whatever the line already had.
    if (m.formula === null)
      return { formula: line.formula, symbols: line.symbols };

    const names = m.symbols.map((s) => s.name);
    const check = validateExpression(m.formula, names);
    const changed = m.formula.trim() !== (line.formula ?? '').trim();

    if (!check.ok) {
      // Reject: never persist an unvalidated formula. Only note it when the model
      // actually proposed a change (an unchanged, already-invalid formula was flagged
      // at extraction — don't repeat the noise).
      if (changed)
        log.push(
          logEntry(
            `Proposed formula rewrite rejected (still invalid: ${check.issues.join('; ')}) — kept the original · ${tag}`,
          ),
        );
      return { formula: line.formula, symbols: line.symbols };
    }

    // Preserve every value the extractor established (and the reserved nulls it left for
    // phase 3); the model may only supply a value for a genuinely NEW symbol name.
    const original = line.symbols ?? {};
    const symbols: Record<string, number | null> = {};
    for (const s of m.symbols)
      symbols[s.name] =
        s.name in original ? original[s.name] : (s.value ?? null);

    if (changed)
      log.push(
        logEntry(
          `Formula corrected from "${line.formula ?? 'null'}" to "${m.formula}" · ${tag}`,
        ),
      );
    return { formula: m.formula, symbols };
  }

  /**
   * The model must return exactly one match per input line. A missing/duplicated id
   * would leave a line unreconciled, so validate and retry-by-fallback: any line the
   * model dropped is coerced to unmatched rather than failing the whole document. A null
   * result (the whole section's extraction returned no parseable tool call) degrades the
   * same way — every line unmatched — instead of crashing the run.
   */
  private validate(
    result: MatchResult | null,
    section: DocumentLineItem[],
    tag: string,
  ): Map<string, LineMatch> {
    const ids = new Set(section.map((l) => l.id));
    const byId = new Map<string, LineMatch>();
    if (!result)
      this.logger.warn(
        `${tag}: no result for this section (${section.length} line(s)) — coercing all to unmatched`,
      );
    for (const m of result?.matches ?? []) {
      if (ids.has(m.id) && !byId.has(m.id)) byId.set(m.id, m);
    }
    for (const line of section) {
      if (!byId.has(line.id)) {
        this.logger.warn(
          `${tag}: no match returned for line ${line.id} — coercing to unmatched`,
        );
        byId.set(line.id, {
          id: line.id,
          reasoning: {
            kind: 'no match returned by model',
            canonical: '',
            tier: '',
            references: '',
            formula: '',
          },
          kind: LINE_ITEM_MATCH_KINDS.UNMATCHED,
          canonicalName: null,
          tierSlug: null,
          referencedIds: [],
          formula: null, // acceptFormula keeps the line's original formula/symbols
          symbols: [],
        });
      }
    }
    return byId;
  }

  /**
   * One batch per invoice — both invoiceRef and sectionLabel equal the chunk label,
   * so grouping by invoiceRef is grouping by invoice.
   */
  private groupByInvoice(items: DocumentLineItem[]): DocumentLineItem[][] {
    const groups = new Map<string, DocumentLineItem[]>();
    for (const it of items) {
      const g = groups.get(it.invoiceRef);
      if (g) g.push(it);
      else groups.set(it.invoiceRef, [it]);
    }
    return [...groups.values()];
  }
}
