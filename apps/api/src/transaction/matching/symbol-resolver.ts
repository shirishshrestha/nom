import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AttributeSet } from '../../attribute-set';
import { ADJUDICATOR_EXTRACTOR } from '../../infra/llm/llm.tokens';
import type { StructuredExtractor } from '../../infra/llm/structured-extractor.port';
import { promptTag } from '../../infra/llm/prompt.types';
import { toTable } from '../../common/prompt-serialize';
import { logEntry } from '../audit-log';
import {
  buildResolveSchema,
  LINE_ITEM_RESOLVE_PROMPT,
  type ResolvedLine,
} from '../schemas/resolve-schema';

/**
 * A line whose formula symbols need resolving — from the rate card (service-matched,
 * canonicalName set) and/or from the reviewer's guidance (canonicalName null for an
 * unmatched line priced purely by guidance).
 */
export interface ResolvableLine {
  id: string;
  description: string;
  canonicalName: string | null;
  tierSlug: string | null;
  formula: string | null;
  symbols: Record<string, number | null> | null;
  guidance: string | null;
}

/** The resolver's per-line result: the merged symbol map and the log lines to append. */
export interface ResolvedRow {
  id: string;
  symbols: Record<string, number | null> | null;
  // Rewritten only by the referenced-expression composer, which re-expresses a line's
  // formula to encode a cross-service pricing chain; undefined for every other resolver
  // (their line keeps its extracted/matched formula).
  formula?: string | null;
  logAdditions: string[];
}

/**
 * Merge a model's resolved values into a line's symbol map — shared by SymbolResolver
 * (rate card) and SiblingSymbolResolver (referenced siblings). Only touches symbols
 * that are present AND currently null — never invents or overwrites.
 */
export function mergeResolvedSymbols(
  line: { id: string; symbols: Record<string, number | null> | null },
  resolved: ResolvedLine | undefined,
  tag: string,
): ResolvedRow {
  const symbols = { ...(line.symbols ?? {}) };
  const logAdditions: string[] = [];
  const seen = new Set<string>();

  for (const rs of resolved?.resolvedSymbols ?? []) {
    if (!(rs.name in symbols)) continue; // never invent a symbol the line didn't declare
    // Guidance may correct a non-null value (reviewer is authoritative); every other
    // source is fill-null-only and skips a symbol that already has a value.
    const override = rs.sourcePath === 'guidance';
    if (symbols[rs.name] !== null && !override) continue;
    seen.add(rs.name);
    if (rs.value === null) {
      logAdditions.push(
        logEntry(`Could not resolve "${rs.name}" — no value found · ${tag}`),
      );
      continue;
    }
    const prev = symbols[rs.name];
    symbols[rs.name] = rs.value;
    logAdditions.push(
      logEntry(
        prev !== null && override
          ? `Overrode "${rs.name}" ${prev} → ${rs.value} by reviewer guidance · ${tag}`
          : `Resolved "${rs.name}" = ${rs.value} (source: ${rs.sourcePath}) · ${tag}`,
      ),
    );
  }

  // Null symbols the model never addressed — note them for the audit trail.
  for (const [name, value] of Object.entries(symbols)) {
    if (value === null && !seen.has(name))
      logAdditions.push(
        logEntry(`Could not resolve "${name}" — no value found · ${tag}`),
      );
  }

  return { id: line.id, symbols, logAdditions };
}

/**
 * Phase 3 — fills the null symbols (e.g. the contracted `rate`) of already-matched
 * line items from the vendor's rate-card cluster, recording where each value came
 * from in the audit log. Distinct from LineItemMatcher: matching links a line to its
 * service; this resolves the arithmetic. Fail-soft — an unresolvable symbol stays null.
 */
@Injectable()
export class SymbolResolver {
  private readonly logger = new Logger(SymbolResolver.name);

  constructor(
    @Inject(ADJUDICATOR_EXTRACTOR)
    private readonly extractor: StructuredExtractor,
  ) {}

  async resolve(
    set: AttributeSet,
    lines: ResolvableLine[],
    cluster: string,
    organizationId: string,
    documentId: string,
    rules?: string,
  ): Promise<ResolvedRow[]> {
    if (lines.length === 0) return [];
    const tag = promptTag(LINE_ITEM_RESOLVE_PROMPT);
    this.logger.debug(`resolving symbols for ${lines.length} matched line(s)`);

    const result = await this.extractor.extract({
      system: LINE_ITEM_RESOLVE_PROMPT.render({ set, cluster, rules }),
      human: toTable(
        lines.map((l) => ({
          id: l.id,
          description: l.description,
          canonicalName: l.canonicalName,
          // A matched untiered service shows "flat" (mirroring the rate-card cluster's
          // "slug flat") so the model bridges to its rate; an unmatched line keeps its
          // null tierSlug ("—"), its "—" canonicalName already signalling no match.
          tierSlug: l.canonicalName ? (l.tierSlug ?? 'flat') : l.tierSlug,
          formula: l.formula,
          symbols: l.symbols ?? {},
          // Reviewer's correction for this line — toTable prunes the column when no line
          // has one, so the no-guidance prompt is byte-identical to before.
          reviewerGuidance: l.guidance,
        })),
      ),
      schema: buildResolveSchema(),
      options: {
        operation: tag,
        reference: {
          organizationId,
          sourceType: 'document',
          sourceId: documentId,
        },
      },
    });

    const byId = new Map<string, ResolvedLine>(
      result.lines.map((r) => [r.id, r]),
    );
    return lines.map((l) => mergeResolvedSymbols(l, byId.get(l.id), tag));
  }
}
