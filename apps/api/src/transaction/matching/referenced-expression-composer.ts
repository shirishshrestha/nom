import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AttributeSet } from '../../attribute-set';
import { ADJUDICATOR_EXTRACTOR } from '../../infra/llm/llm.tokens';
import type { StructuredExtractor } from '../../infra/llm/structured-extractor.port';
import { promptTag } from '../../infra/llm/prompt.types';
import { toTable } from '../../common/prompt-serialize';
import { logEntry } from '../audit-log';
import { validateExpression } from '../expression/validate-expression';
import {
  buildComposeSchema,
  LINE_ITEM_COMPOSE_PROMPT,
  type ComposedLine,
} from '../schemas/referenced-compose-schema';
import type { ResolvedRow } from './symbol-resolver';

/** One pricing dependency shown to the model: which service, and the relationship wording. */
export interface ComposeReference {
  fromCanonical: string;
  referencedCanonical: string;
  relation: string;
  referencedTierSlug: string | null;
}

/** A line billed as a referencing service, whose formula must be re-expressed as a chain. */
export interface ComposableLine {
  id: string;
  description: string;
  canonicalName: string;
  formula: string | null;
  symbols: Record<string, number | null> | null;
  attributes: Record<string, string | number | null>;
  references: ComposeReference[];
}

/**
 * Phase 3c — for line items billed as a service whose price DERIVES from another
 * ("B = 40% of A"), rewrites the formula to encode the dependency chain and sources its
 * symbols from the referenced services' pricingContext + this line's base attribute. The
 * model emits the SYMBOLIC expression only; well-formedness is checked with the same
 * `validateExpression` matching uses, and evaluation stays deterministic downstream.
 * Fail-soft — a line the model can't express (null/invalid formula) is left untouched, so
 * reconciliation verdicts it needs_review. Only successfully-composed rows are returned;
 * the flow merges them over the rate-card resolver's rows by id.
 */
@Injectable()
export class ReferencedExpressionComposer {
  private readonly logger = new Logger(ReferencedExpressionComposer.name);

  constructor(
    @Inject(ADJUDICATOR_EXTRACTOR)
    private readonly extractor: StructuredExtractor,
  ) {}

  async compose(
    set: AttributeSet,
    lines: ComposableLine[],
    cluster: string,
    organizationId: string,
    documentId: string,
    rules?: string,
  ): Promise<ResolvedRow[]> {
    if (lines.length === 0) return [];
    const tag = promptTag(LINE_ITEM_COMPOSE_PROMPT);
    this.logger.debug(
      `composing referenced formulas for ${lines.length} line(s)`,
    );

    const result = await this.extractor.extract({
      system: LINE_ITEM_COMPOSE_PROMPT.render({ set, cluster, rules }),
      human: toTable(
        lines.map((l) => ({
          id: l.id,
          description: l.description,
          canonicalName: l.canonicalName,
          formula: l.formula,
          symbols: l.symbols ?? {},
          attributes: l.attributes,
          references: l.references.map(
            (r) =>
              `${r.fromCanonical} is priced from ${r.referencedCanonical}: ${r.relation}`,
          ),
        })),
      ),
      schema: buildComposeSchema(),
      options: {
        operation: tag,
        reference: {
          organizationId,
          sourceType: 'document',
          sourceId: documentId,
        },
      },
    });

    const byId = new Map<string, ComposedLine>(
      result.lines.map((r) => [r.id, r]),
    );
    const rows: ResolvedRow[] = [];
    for (const line of lines) {
      const row = this.accept(line, byId.get(line.id), tag);
      if (row) rows.push(row);
    }
    return rows;
  }

  // Accept the model's rewrite for one line — mirrors LineItemMatcher.acceptFormula:
  // reject an invalid/absent formula (leave the line to needs_review), otherwise take the
  // new formula and its symbols, preserving any value the invoice already established.
  private accept(
    line: ComposableLine,
    composed: ComposedLine | undefined,
    tag: string,
  ): ResolvedRow | null {
    if (!composed || composed.formula === null) return null;

    const names = composed.symbols.map((s) => s.name);
    const check = validateExpression(composed.formula, names);
    if (!check.ok) {
      this.logger.debug(
        `rejected referenced rewrite for line ${line.id}: ${check.issues.join('; ')}`,
      );
      return null;
    }

    const original = line.symbols ?? {};
    const symbols: Record<string, number | null> = {};
    const logAdditions: string[] = [];
    for (const s of composed.symbols) {
      // Keep an invoice-known value (e.g. quantity); take the model's value for a genuinely
      // new symbol (base, pctA, …). Never let the model overwrite an established value.
      symbols[s.name] =
        s.name in original ? original[s.name] : (s.value ?? null);
      if (!(s.name in original))
        logAdditions.push(
          s.value === null
            ? logEntry(
                `Could not resolve "${s.name}" — no value found · ${tag}`,
              )
            : logEntry(
                `Resolved "${s.name}" = ${s.value} (source: ${s.sourcePath}) · ${tag}`,
              ),
        );
    }
    logAdditions.push(
      logEntry(
        `Composed referenced formula "${line.formula ?? 'null'}" → "${composed.formula}" · ${tag}`,
      ),
    );
    return { id: line.id, formula: composed.formula, symbols, logAdditions };
  }
}
