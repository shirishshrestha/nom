import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { AttributeSet } from '../../attribute-set';
import { ADJUDICATOR_EXTRACTOR } from '../../infra/llm/llm.tokens';
import type { StructuredExtractor } from '../../infra/llm/structured-extractor.port';
import { promptTag } from '../../infra/llm/prompt.types';
import { normalizeCanonical } from '../../common/canonical';
import { toTable } from '../../common/prompt-serialize';
import { filterRegistryForBatch } from '../../common/registry-filter';
import { CanonicalRegistryRepository } from '../../infra/graph/canonical-registry.repository';
import {
  buildCanonicalMatchSchema,
  CANONICAL_MATCH_PROMPT,
  type CanonicalMatchResult,
  type CanonicalRegistryEntry,
  type TierRegistryEntry,
} from '../service-schema';

/**
 * Soft cap on lines per reconcile call - keeps each prompt's context small and
 * focused. A canonical group is never split across batches (see match()). Kept
 * modest because each line now resolves both a canonical name AND a tier slug.
 */
export const RECONCILE_BATCH_SIZE = 12;

/**
 * The concept-bearing slice of a staged service the matcher reasons over.
 * `canonicalName` is the CURRENT grouping (used only to batch - never sent to the
 * model, so it can't anchor a split decision).
 */
export interface CanonicalMatchLine {
  id: string;
  canonicalName: string;
  title: string;
  tier: string | null;
  pricingContext: string;
  attributes: Record<string, string | number | null>;
  sectionContext: string | null; // section-level qualifier scoping this line's chunk
}

export interface CanonicalAssignment {
  canonicalName: string;
  canonicalDescription: string;
  tierSlug: string | null;
}

/**
 * Resolves canonical names for staged service lines against the vendor's existing
 * registry, on the Haiku adjudicator. Per-line (id-keyed) so it can both MERGE
 * (reuse an existing registry name) and SPLIT (give two wrongly-grouped lines
 * different names). Batched by canonical group to bound context while keeping a
 * concept's tier-rows - and any over-merged rows - co-located in one call.
 */
@Injectable()
export class CanonicalMatcher {
  private readonly logger = new Logger(CanonicalMatcher.name);

  constructor(
    @Inject(ADJUDICATOR_EXTRACTOR)
    private readonly extractor: StructuredExtractor,
    private readonly canonicalRegistry: CanonicalRegistryRepository,
  ) {}

  async match(
    set: AttributeSet,
    lines: CanonicalMatchLine[],
    registry: CanonicalRegistryEntry[],
    tierRegistry: TierRegistryEntry[],
    tenantId: string,
    vendorId: string,
    documentId: string,
    rules?: string,
  ): Promise<Map<string, CanonicalAssignment>> {
    if (lines.length === 0) return new Map();

    const batches = this.batchByGroup(lines);
    const schema = buildCanonicalMatchSchema();
    this.logger.debug(
      `matching ${lines.length} line(s) in ${batches.length} batch(es)`,
    );

    // Sequential with registries that grow as they go (mirrors ServiceExtractor):
    // each batch's prompt carries the names + tier slugs minted by earlier batches,
    // so the same concept/band converges ACROSS batches — the cross-batch guard the
    // prompt alone can't give. Cold start (empty registry) self-seeds from batch one.
    // ponytail: sequential over parallel; fine for rate-card sizes (1-3 batches).
    // Re-introduce bounded concurrency only if one vendor doc ever fans out wide.
    const known = [...registry];
    const seen = new Set(known.map((c) => c.canonicalName));
    const tiers = [...tierRegistry];
    const tierSeen = new Set(
      tiers.map((t) => `${t.canonicalName}:${t.tierSlug}`),
    );
    const result = new Map<string, CanonicalAssignment>();

    for (const batch of batches) {
      const batchIds = new Set(batch.map((l) => l.id));
      // Send only the judging fields — the current canonicalName is omitted so it
      // can't anchor the model's decision.
      const human = toTable(
        batch.map((l) => ({
          id: l.id,
          title: l.title,
          tier: l.tier,
          pricingContext: l.pricingContext,
          sectionContext: l.sectionContext,
          attributes: l.attributes,
        })),
      );

      // Size-gated pre-filter — only kicks in once `known` grows past the threshold;
      // `known`/`tiers` (unfiltered) keep tracking cross-batch minting either way.
      const filtered = await filterRegistryForBatch(
        this.canonicalRegistry,
        tenantId,
        vendorId,
        known,
        tiers,
        batch.map((l) => l.title).join(' '),
        batch.map((l) => l.canonicalName),
      );

      // The model must return exactly one assignment per input line. A missing or
      // duplicated id would silently leave a line unreconciled, so validate and
      // retry once before failing rather than committing a half-matched batch.
      let assignments: CanonicalMatchResult['assignments'] = [];
      let valid = false;
      for (let attempt = 0; attempt < 2 && !valid; attempt++) {
        const res = await this.extractor.extract<CanonicalMatchResult>({
          system: CANONICAL_MATCH_PROMPT.render({
            set,
            registry: filtered.registry,
            tiers: filtered.tiers,
            rules,
          }),
          human,
          schema,
          options: {
            operation: promptTag(CANONICAL_MATCH_PROMPT),
            reference: {
              organizationId: tenantId,
              sourceType: 'document',
              sourceId: documentId,
            },
          },
        });
        const ids = res.assignments.map((a) => a.id);
        valid =
          ids.length === batchIds.size &&
          new Set(ids).size === ids.length &&
          ids.every((id) => batchIds.has(id));
        if (valid) assignments = res.assignments;
        else if (attempt === 0)
          this.logger.warn(
            `batch of ${batch.length} returned a bad assignment set; retrying`,
          );
      }
      if (!valid)
        throw new BadRequestException(
          `Canonical match did not return one assignment per line for a batch of ${batch.length}`,
        );

      for (const a of assignments) {
        const canonicalName = normalizeCanonical(a.canonicalName);
        // ponytail: soft guard, not enforcement — the name is the graph MERGE key so
        // truncating it would corrupt supersession. Just surface over-specified names
        // (kitchen-sink minting) so prompt/guidance drift is visible in logs.
        if (canonicalName.split('_').length > 4)
          this.logger.warn(
            `long canonicalName "${canonicalName}" (${canonicalName.split('_').length} tokens) — likely over-specified`,
          );
        const tierSlug = a.tierSlug
          ? normalizeCanonical(a.tierSlug) || null
          : null;
        // ponytail: soft guard, same as canonicalName above — tierSlug is the band's
        // MERGE key so never truncate; just surface an over-specified enumeration
        // (e.g. a whole commodity list) so grain drift shows up in logs.
        if (tierSlug && tierSlug.split('_').length > 4)
          this.logger.warn(
            `long tierSlug "${tierSlug}" (${tierSlug.split('_').length} tokens) — likely a member list, not a subcategory`,
          );
        result.set(a.id, {
          canonicalName,
          canonicalDescription: a.canonicalDescription,
          tierSlug,
        });
        if (!seen.has(canonicalName)) {
          seen.add(canonicalName);
          known.push({ canonicalName, description: a.canonicalDescription });
        }
        const tierKey = `${canonicalName}:${tierSlug}`;
        if (tierSlug && !tierSeen.has(tierKey)) {
          tierSeen.add(tierKey);
          tiers.push({
            canonicalName,
            tierSlug,
            label: null,
            pricingContext: null,
            attributes: null,
          });
        }
      }
    }

    return result;
  }

  /**
   * Group lines by their current canonicalName, then greedily pack whole groups
   * into batches of <= RECONCILE_BATCH_SIZE lines - never splitting a group, so
   * tier-rows stay together and over-merged rows are judged side-by-side.
   * ponytail: registry sent whole per batch; add a pre-filter only if a vendor's
   * registry grows into the hundreds.
   */
  private batchByGroup(lines: CanonicalMatchLine[]): CanonicalMatchLine[][] {
    const groups = new Map<string, CanonicalMatchLine[]>();
    for (const line of lines) {
      const g = groups.get(line.canonicalName);
      if (g) g.push(line);
      else groups.set(line.canonicalName, [line]);
    }

    const batches: CanonicalMatchLine[][] = [];
    let current: CanonicalMatchLine[] = [];
    for (const group of groups.values()) {
      if (
        current.length &&
        current.length + group.length > RECONCILE_BATCH_SIZE
      ) {
        batches.push(current);
        current = [];
      }
      current.push(...group);
    }
    if (current.length) batches.push(current);
    return batches;
  }
}
