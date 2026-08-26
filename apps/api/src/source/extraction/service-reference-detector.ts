import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PricingRef } from '@nom/shared';
import type { AttributeSet } from '../../attribute-set';
import { ADJUDICATOR_EXTRACTOR } from '../../infra/llm/llm.tokens';
import type { StructuredExtractor } from '../../infra/llm/structured-extractor.port';
import { promptTag } from '../../infra/llm/prompt.types';
import { normalizeCanonical } from '../../common/canonical';
import { toTable } from '../../common/prompt-serialize';
import {
  buildServiceReferenceSchema,
  SERVICE_REFERENCE_PROMPT,
  type ServiceReferenceResult,
} from '../service-schema';

/** The concept + pricing slice a reference is detected from. */
export interface ReferenceDetectLine {
  id: string;
  canonicalName: string;
  title: string;
  pricingContext: string;
}

/**
 * Detects CROSS-SERVICE pricing references ("service B = 40% of service A") across a
 * document's reconciled service lines, on the Haiku adjudicator. Runs after canonical
 * reconcile so `canonicalName`s are final — the reference targets a canonical, and
 * both sides are visible in one call (references cross canonical groups, so this pass
 * is NOT batched by group). Fail-soft: any reference to an unknown/own canonical is
 * dropped rather than committed. Only WHICH service + the verbatim wording is captured;
 * the arithmetic is interpreted later by the match-time composition phase.
 */
@Injectable()
export class ServiceReferenceDetector {
  private readonly logger = new Logger(ServiceReferenceDetector.name);

  constructor(
    @Inject(ADJUDICATOR_EXTRACTOR)
    private readonly extractor: StructuredExtractor,
  ) {}

  async detect(
    set: AttributeSet,
    lines: ReferenceDetectLine[],
    tenantId: string,
    documentId: string,
  ): Promise<Map<string, PricingRef>> {
    // A reference needs at least two distinct services to point between.
    if (lines.length < 2) return new Map();

    const canonicalById = new Map(lines.map((l) => [l.id, l.canonicalName]));
    const canonicals = new Set(lines.map((l) => l.canonicalName));

    const result = await this.extractor.extract<ServiceReferenceResult>({
      system: SERVICE_REFERENCE_PROMPT.render({ set }),
      human: toTable(
        lines.map((l) => ({
          id: l.id,
          canonicalName: l.canonicalName,
          title: l.title,
          pricingContext: l.pricingContext,
        })),
      ),
      schema: buildServiceReferenceSchema(),
      options: {
        operation: promptTag(SERVICE_REFERENCE_PROMPT),
        reference: {
          organizationId: tenantId,
          sourceType: 'document',
          sourceId: documentId,
        },
      },
    });

    const refs = new Map<string, PricingRef>();
    for (const r of result.references) {
      const fromCanonical = canonicalById.get(r.fromId);
      if (fromCanonical === undefined) continue; // unknown line id
      const referencedCanonical = normalizeCanonical(r.referencedCanonical);
      // Must point at a REAL other service — drop hallucinated targets and self-refs.
      if (!canonicals.has(referencedCanonical)) continue;
      if (referencedCanonical === fromCanonical) continue;
      refs.set(r.fromId, {
        referencedCanonical,
        referencedTierSlug: r.referencedTierSlug
          ? normalizeCanonical(r.referencedTierSlug) || null
          : null,
        relation: r.relation,
      });
    }

    this.logger.debug(
      `detected ${refs.size} pricing reference(s) across ${lines.length} line(s)`,
    );
    return refs;
  }
}
