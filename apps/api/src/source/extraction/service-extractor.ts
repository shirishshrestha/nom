import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ContentEntity } from '@nom/database';
import type { DocumentMetadata, StagedService } from '@nom/shared';
import type { AttributeSet } from '../../attribute-set';
import { STRUCTURED_EXTRACTOR } from '../../infra/llm/llm.tokens';
import type { StructuredExtractor } from '../../infra/llm/structured-extractor.port';
import { promptTag } from '../../infra/llm/prompt.types';
import {
  buildServiceSchema,
  SERVICE_EXTRACT_PROMPT,
  type CanonicalRegistryEntry,
  type TierRegistryEntry,
} from '../service-schema';
import { normalizeCanonical } from '../../common/canonical';
import { mdToPlain } from '../../common/text';

/**
 * Sequential by design: each chunk's prompt includes canonicals minted by the
 * previous chunks so the model reuses names instead of inventing duplicates.
 */
@Injectable()
export class ServiceExtractor {
  private readonly logger = new Logger(ServiceExtractor.name);

  constructor(
    @Inject(STRUCTURED_EXTRACTOR)
    private readonly extractor: StructuredExtractor,
  ) {}

  async extract(
    attributeSet: AttributeSet,
    sections: ContentEntity[],
    knownCanonicals: CanonicalRegistryEntry[],
    knownTiers: TierRegistryEntry[],
    metadata: DocumentMetadata,
    rules?: string,
  ): Promise<StagedService[]> {
    const schema = buildServiceSchema(attributeSet);
    const canonicals = [...knownCanonicals];
    const tiers = [...knownTiers];
    const tierSeen = new Set(
      tiers.map((t) => `${t.canonicalName}:${t.tierSlug}`),
    );
    const services: StagedService[] = [];

    for (const [i, chunk] of sections.entries()) {
      this.logger.debug(
        `extracting chunk ${i + 1}/${sections.length} "${chunk.label}"`,
      );
      const { services: extracted, sectionContext } =
        await this.extractor.extract({
          system: SERVICE_EXTRACT_PROMPT.render({
            set: attributeSet,
            runningCanonicals: canonicals,
            runningTiers: tiers,
            metadata,
            rules,
          }),
          human: `## ${chunk.label}\n\n${chunk.text}`,
          schema,
          options: {
            operation: promptTag(SERVICE_EXTRACT_PROMPT),
            reference: {
              organizationId: chunk.organizationId,
              sourceType: 'content',
              sourceId: chunk.id,
            },
          },
        });

      for (const e of extracted) {
        const canonicalName = normalizeCanonical(e.canonicalName);
        const tierSlug = e.tierSlug
          ? normalizeCanonical(e.tierSlug) || null
          : null;
        services.push({
          id: randomUUID(),
          canonicalName,
          canonicalDescription: e.canonicalDescription,
          title: e.title,
          category: e.category,
          tier: e.tier,
          tierSlug,
          pricingContext: e.pricingContext,
          pricingRef: null, // detected later at commit by ServiceReferenceDetector
          // dynamic bag — shape is enforced by the attribute-set schema
          attributes: e.attributes as Record<string, string | number | null>,
          meta: {
            foundAt: e.foundAt,
            sourceText: e.sourceText ? mdToPlain(e.sourceText) : e.sourceText,
            contentId: chunk.id,
            sectionLabel: chunk.label,
            position: chunk.position,
            sectionContext: sectionContext ?? null,
          },
          log: `extracted by ${promptTag(SERVICE_EXTRACT_PROMPT)} · ${e.foundAt ?? chunk.label}`,
        });

        if (!canonicals.some((c) => c.canonicalName === canonicalName))
          canonicals.push({
            canonicalName,
            description: e.canonicalDescription,
          });

        const tierKey = `${canonicalName}:${tierSlug}`;
        if (tierSlug && !tierSeen.has(tierKey)) {
          tierSeen.add(tierKey);
          tiers.push({
            canonicalName,
            tierSlug,
            label: e.tier,
            pricingContext: e.pricingContext,
            attributes: null,
          });
        }
      }
    }

    this.logger.log(
      `extracted ${services.length} service(s) from ${sections.length} chunk(s), ${canonicals.length} canonical(s)`,
    );
    return services;
  }
}
