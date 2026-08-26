import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AttributeSet } from '../../attribute-set';
import { ADJUDICATOR_EXTRACTOR } from '../../infra/llm/llm.tokens';
import type { StructuredExtractor } from '../../infra/llm/structured-extractor.port';
import { promptTag } from '../../infra/llm/prompt.types';
import { toTable } from '../../common/prompt-serialize';
import {
  buildResolveSchema,
  type ResolvedLine,
} from '../schemas/resolve-schema';
import { LINE_ITEM_SIBLING_RESOLVE_PROMPT } from '../schemas/sibling-resolve-schema';
import { mergeResolvedSymbols, type ResolvedRow } from './symbol-resolver';

/** A referenced sibling as shown to the model: its identity + billed amount. */
export interface SiblingReference {
  id: string;
  description: string;
  billedAmount: number | null;
}

/** A sibling_ref line whose formula symbols need resolving from its referenced siblings. */
export interface SiblingResolvableLine {
  id: string;
  description: string;
  formula: string | null;
  symbols: Record<string, number | null> | null;
  references: SiblingReference[];
}

/**
 * Phase 3b — fills the null symbols (e.g. the `base` of a "% of other lines" charge)
 * of sibling_ref line items from their referenced siblings' billed amounts, recording
 * where each value came from in the audit log. Mirrors SymbolResolver: matching wrote
 * the REFERENCES edges; this resolves the arithmetic they imply. Fail-soft — an
 * unresolvable symbol stays null and reconciliation verdicts the line needs_review.
 */
@Injectable()
export class SiblingSymbolResolver {
  private readonly logger = new Logger(SiblingSymbolResolver.name);

  constructor(
    @Inject(ADJUDICATOR_EXTRACTOR)
    private readonly extractor: StructuredExtractor,
  ) {}

  async resolve(
    set: AttributeSet,
    lines: SiblingResolvableLine[],
    organizationId: string,
    documentId: string,
    rules?: string,
  ): Promise<ResolvedRow[]> {
    if (lines.length === 0) return [];
    const tag = promptTag(LINE_ITEM_SIBLING_RESOLVE_PROMPT);
    this.logger.debug(`resolving sibling symbols for ${lines.length} line(s)`);

    const result = await this.extractor.extract({
      system: LINE_ITEM_SIBLING_RESOLVE_PROMPT.render({ set, rules }),
      human: toTable(
        lines.map((l) => ({
          id: l.id,
          description: l.description,
          formula: l.formula,
          symbols: l.symbols ?? {},
          references: l.references.map(
            (r) => `${r.id} (${r.description}) = ${r.billedAmount ?? 'null'}`,
          ),
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
