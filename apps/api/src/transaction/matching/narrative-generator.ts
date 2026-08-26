import { Inject, Injectable, Logger } from '@nestjs/common';
import type { LineItemStatus } from '@nom/shared';
import type { AttributeSet } from '../../attribute-set';
import { STRUCTURED_EXTRACTOR } from '../../infra/llm/llm.tokens';
import type { StructuredExtractor } from '../../infra/llm/structured-extractor.port';
import { promptTag } from '../../infra/llm/prompt.types';
import { toTable } from '../../common/prompt-serialize';
import {
  buildNarrativeSchema,
  LINE_ITEM_NARRATIVE_PROMPT,
} from '../schemas/narrative-schema';

/** A reconciled line that diverged (mismatch / needs_review) and needs a narrative. */
export interface NarratableLine {
  id: string;
  description: string;
  status: LineItemStatus;
  formula: string | null;
  symbols: Record<string, number | null> | null;
  expectedAmount: number | null;
  billedAmount: number | null;
  reviewNote: string | null;
  matchedPricingContext: string | null;
  matchedServiceAttributes: Record<string, string | number | null> | null;
  attributes: Record<string, string | number | null>;
}

/** ponytail: narratives are verbose per line; tune if calls run long. */
export const NARRATIVE_BATCH_SIZE = 8;

/**
 * Post-reconciliation phase — authors a reviewer-facing narrative for each diverging
 * line (mismatch / needs_review) across bounded-concurrency Gemini batches. Fail-soft by
 * contract: the flow swallows any error, so a failed generation leaves the line's
 * narrative null and the DTO layer falls back to its deterministic template.
 */
@Injectable()
export class NarrativeGenerator {
  private readonly logger = new Logger(NarrativeGenerator.name);

  constructor(
    @Inject(STRUCTURED_EXTRACTOR)
    private readonly extractor: StructuredExtractor,
  ) {}

  async generate(
    set: AttributeSet,
    lines: NarratableLine[],
    vendorName: string | null,
    organizationId: string,
    documentId: string,
    rules?: string,
  ): Promise<Map<string, string>> {
    if (lines.length === 0) return new Map();
    const tag = promptTag(LINE_ITEM_NARRATIVE_PROMPT);

    const system = LINE_ITEM_NARRATIVE_PROMPT.render({
      set,
      vendorName,
      rules,
    });
    const schema = buildNarrativeSchema();
    const batches: NarratableLine[][] = [];
    for (let i = 0; i < lines.length; i += NARRATIVE_BATCH_SIZE)
      batches.push(lines.slice(i, i + NARRATIVE_BATCH_SIZE));

    this.logger.debug(
      `composing narratives for ${lines.length} line(s) in ${batches.length} batch(es)`,
    );

    const perBatch = await this.extractor.extractMany(
      batches,
      (batch) => ({
        system,
        human: toTable(
          batch.map((l) => ({
            id: l.id,
            description: l.description,
            status: l.status,
            formula: l.formula,
            symbols: l.symbols ?? {},
            expected: l.expectedAmount,
            billed: l.billedAmount,
            difference:
              l.expectedAmount != null && l.billedAmount != null
                ? l.billedAmount - l.expectedAmount
                : null,
            ratePricing: l.matchedPricingContext,
            rateAttributes: l.matchedServiceAttributes ?? {},
            lineAttributes: l.attributes,
            reviewNote: l.reviewNote,
          })),
        ),
        schema,
        options: {
          operation: tag,
          reference: {
            organizationId,
            sourceType: 'document',
            sourceId: documentId,
          },
        },
      }),
      { operation: tag },
    );

    return new Map(
      perBatch
        .flatMap((r) => r.lines)
        .filter((r) => r.narrative.trim().length > 0)
        .map((r) => [r.id, r.narrative]),
    );
  }
}
