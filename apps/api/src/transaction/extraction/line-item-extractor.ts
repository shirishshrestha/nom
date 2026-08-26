import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ContentEntity } from '@nom/database';
import type { DocumentMetadata, LineItem } from '@nom/shared';
import type { AttributeSet } from '../../attribute-set';
import { STRUCTURED_EXTRACTOR } from '../../infra/llm/llm.tokens';
import type { StructuredExtractor } from '../../infra/llm/structured-extractor.port';
import { promptTag } from '../../infra/llm/prompt.types';
import type {
  CanonicalRegistryEntry,
  TierRegistryEntry,
} from '../../infra/graph/canonical-registry.repository';
import { normalizeCanonical } from '../../common/canonical';
import { logEntry, provenanceHeader } from '../audit-log';
import { validateExpression } from '../expression/validate-expression';
import {
  buildLineItemSchema,
  LINE_ITEM_EXTRACT_PROMPT,
  type ExtractedLineItem,
} from '../schemas/line-item-schema';

/**
 * Turns a validated transaction document's content chunks into billed line items.
 * Each chunk is one invoice (the transaction extraction prompt chunks per invoice),
 * so every line it returns is tagged with that invoice's ref (the chunk label).
 *
 * Phase 1 of matching runs here: the vendor's canonical registry is passed in and the
 * model assigns each line an `initial*` guess (service_match / sibling_ref / unmatched).
 * Independent per chunk - we only MATCH to existing canonicals, never mint new ones -
 * so unlike ServiceExtractor the registry does NOT grow as it goes, and chunks run
 * concurrently.
 */
@Injectable()
export class LineItemExtractor {
  private readonly logger = new Logger(LineItemExtractor.name);

  constructor(
    @Inject(STRUCTURED_EXTRACTOR)
    private readonly extractor: StructuredExtractor,
  ) {}

  async extract(
    attributeSet: AttributeSet,
    sections: ContentEntity[],
    registry: CanonicalRegistryEntry[],
    tiers: TierRegistryEntry[],
    metadata: DocumentMetadata,
    rules?: string,
  ): Promise<LineItem[]> {
    const schema = buildLineItemSchema(attributeSet);
    const tag = promptTag(LINE_ITEM_EXTRACT_PROMPT);
    // The system prompt is identical for every chunk (set / registry / metadata /
    // rules don't vary per chunk) — render it once, not once per fan-out call.
    const system = LINE_ITEM_EXTRACT_PROMPT.render({
      set: attributeSet,
      registry,
      tiers,
      metadata,
      rules,
    });
    this.logger.debug(`extracting line-items from ${sections.length} chunk(s)`);

    const perChunk = await this.extractor.extractMany(
      sections,
      (chunk) => ({
        system,
        human: `## ${chunk.label}\n\n${chunk.text}`,
        schema,
        options: {
          operation: tag,
          reference: {
            organizationId: chunk.organizationId,
            sourceType: 'content',
            sourceId: chunk.id,
          },
        },
      }),
      { operation: tag },
    );

    return sections.flatMap((chunk, i) =>
      perChunk[i].lineItems.map((e) =>
        toLineItem(chunk, e, tag, perChunk[i].sectionContext ?? null),
      ),
    );
  }
}

/** The extractor's first-pass classification, phrased for the audit trail. */
function initialGuess(
  canonical: string | null,
  tierSlug: string | null,
  refSummary: string | null,
): string {
  if (canonical)
    return `bills rate-card service "${canonical}"${tierSlug ? ` (tier "${tierSlug}")` : ''}`;
  if (refSummary) return `computed from sibling line(s) "${refSummary}"`;
  return 'no rate-card match';
}

function toLineItem(
  chunk: ContentEntity,
  e: ExtractedLineItem,
  tag: string,
  sectionContext: string | null,
): LineItem {
  const initialCanonical = e.initialCanonical
    ? normalizeCanonical(e.initialCanonical) || null
    : null;
  const initialTierSlug = e.initialTierSlug
    ? normalizeCanonical(e.initialTierSlug) || null
    : null;
  const formulaCheck = validateExpression(
    e.formula,
    e.symbols.map((s) => s.name),
  );
  return {
    id: randomUUID(),
    description: e.description,
    invoiceRef: chunk.label,
    sectionLabel: chunk.label,
    attributes: e.attributes as Record<string, string | number | null>,
    taxable: e.taxable,
    taxPercentage: e.taxPercentage ?? 0,
    formula: e.formula,
    symbols: Object.fromEntries(e.symbols.map((s) => [s.name, s.value])),
    initialKind: e.initialKind,
    initialCanonical,
    initialTierSlug,
    initialRefSummary: e.initialRefSummary,
    meta: {
      foundAt: e.foundAt,
      sourceText: e.sourceText,
      contentId: chunk.id,
      position: chunk.position,
      sectionContext,
    },
    log: [
      provenanceHeader({
        documentId: chunk.documentId,
        contentId: chunk.id,
        invoiceRef: chunk.label,
        position: chunk.position,
        extractor: tag,
      }),
      logEntry(
        `Extracted from invoice "${chunk.label}"; initial guess: ${initialGuess(
          initialCanonical,
          initialTierSlug,
          e.initialRefSummary,
        )}.`,
      ),
      logEntry(
        formulaCheck.ok
          ? `Captured formula "${e.formula}" — well-formed.`
          : `Captured formula "${e.formula}" — invalid: ${formulaCheck.issues.join('; ')}.`,
      ),
    ],
  };
}
