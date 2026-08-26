import { z } from 'zod';
import type { DocumentMetadata } from '@nom/shared';
import type { AttributeSet } from '../attribute-set';
import { describeAttributes } from '../attribute-set';
import type { PromptTemplate } from '../infra/llm/prompt.types';
import {
  renderRegistry,
  renderNamingBlock,
  renderRulesBlock,
  renderDocumentContext,
} from '../common/registry-render';
import type {
  CanonicalRegistryEntry,
  TierRegistryEntry,
} from '../infra/graph/canonical-registry.repository';

export type { CanonicalRegistryEntry, TierRegistryEntry };

// Dynamic structured-output schema + system prompt for service extraction. The
// attribute bag is generated entirely from the AI-detected attribute set — nothing
// about the line-item shape is hardcoded per document type. The schema and the
// prompt's attribute lines both come from describeAttributes (one walk, no drift).

export function buildServiceSchema(set: AttributeSet) {
  const { schema: attributesSchema } = describeAttributes(set);
  const item = z.object({
    title: z
      .string()
      .describe('Verbatim service / line title from the document.'),
    nameBasis: z
      .string()
      .describe(
        'Scratch space: your one-line application of the naming procedure — concept, then distinguishing axis, then band grain. Fill this FIRST; it is discarded after extraction.',
      ),
    canonicalName: z
      .string()
      .describe(
        'The service CONCEPT in lowercase snake_case — what a customer would call the service, SHORT (2 to 4 tokens naming what the service IS). NEVER the axis that separates priced lines: whatever qualifier varies across bands belongs in tier/tierSlug/pricingContext/attributes, not here, and qualifiers/inclusions/exclusions are never chained into the name (NOT "some_service_variant_a"; just "some_service"). The SAME value across every tier of one concept (test: would a customer call these the same service billed at different bands? → same canonicalName). Reuse an existing registry name when the concept matches; never mint a near-duplicate.',
      ),
    canonicalDescription: z
      .string()
      .describe(
        'One-line description of the CONCEPT, at the same generality as canonicalName — never a specific tier / route / size / commodity / value. All tiers of one concept must be describable by this SAME sentence. Required.',
      ),
    category: z
      .string()
      .nullable()
      .describe(
        'Free-form tag for this service (your choice); null if unclear.',
      ),
    tier: z
      .string()
      .nullable()
      .describe(
        'Tier / band label at the COARSEST grain that still separates it from the sibling bands — a short subcategory phrase (e.g. "0-100 units", "tier 1", "foodstuffs"), never a verbatim member list or enumeration (the full list stays in pricingContext / sourceText). Emit ONE entry per tier; null if untiered.',
      ),
    tierSlug: z
      .string()
      .nullable()
      .describe(
        'Normalized snake_case band id for this tier (e.g. "variant_a", "0_100_units"), 1-3 tokens naming the distinguishing axis value at the COARSEST grain that still separates it from the sibling bands — a subcategory, never a verbatim member list, never so broad it collides. The SAME slug for the same band across lines/docs — reuse a slug listed under the matching canonical below when it is the same band; null when this line is a single flat rate with no band.',
      ),
    pricingContext: z
      .string()
      .describe(
        'This line\'s remarks PLUS any other context relevant to how it is priced / calculated (basis, conditions, qualifiers). Self-contained: restate the actual values — never reference other lines ("same as above").',
      ),
    foundAt: z
      .string()
      .nullable()
      .describe('Where in the document this line appears, or null.'),
    sourceText: z
      .string()
      .describe(
        'The verbatim snippet copied from this chunk that identifies this service line (for highlighting the source text in the review UI).',
      ),
    attributes: attributesSchema.describe(
      `Rate / coverage values for this line (${set.key} attribute set).`,
    ),
  });
  return z.object({
    services: z
      .array(item)
      .describe(
        'One entry per priced line. A tiered line becomes N entries sharing canonicalName, each with its own tier + attributes. Drop grand-total / summary rows.',
      ),
    sectionContext: z
      .string()
      .nullable()
      .describe(
        'A section-level qualifier that scopes ALL lines in THIS chunk (e.g. a section banner, validity window, zone/route/mode restriction, or "FCL only") — captured once, verbatim/condensed. Null if the chunk has no such qualifier.',
      ),
  });
}

export type ServiceExtractionResult = z.infer<
  ReturnType<typeof buildServiceSchema>
>;
export type ExtractedService = ServiceExtractionResult['services'][number];

const SERVICE_REGISTRY_EMPTY_MESSAGE =
  '(none yet — this is the first canonical service for this vendor)';

// System prompt for one chunk's extraction call. `runningCanonicals` / `runningTiers`
// are the registries accumulated so far (existing vendor canonicals + tier slugs plus
// ones minted in earlier chunks of this run) so the model reuses them.
export function buildServiceSystemPrompt(
  set: AttributeSet,
  runningCanonicals: CanonicalRegistryEntry[],
  runningTiers: TierRegistryEntry[],
  metadata: DocumentMetadata,
  rules?: string,
): string {
  const { promptLines: attrLines } = describeAttributes(set);
  // includeAttributes=false: the extractor mints each service's price from the source
  // document alone; showing it existing registry prices would risk anchoring extracted
  // rates toward them over time.
  const registry = renderRegistry(
    runningCanonicals,
    runningTiers,
    SERVICE_REGISTRY_EMPTY_MESSAGE,
    false,
  );

  // Vertical-specific naming rules from the attribute set, then vendor rules,
  // appended last so they read as overrides.
  // Empty/undefined → no block, so the prompt is byte-identical to the default.
  const namingBlock = renderNamingBlock(set);
  const rulesBlock = renderRulesBlock(rules);

  const documentContext = renderDocumentContext(metadata);

  return `${set.promptContext}

You receive ONE chunk of a ${set.label} document. Extract every priced service line into the required structure — the schema field descriptions define each field's exact format; follow them. Your output feeds a knowledge graph that links the same service across many of this vendor's documents over time: canonicalName is the stable identifier used to match a line to its earlier versions, so a consistent, accurate name lets a new rate correctly supersede the old one — a wrong merge collapses two distinct rates into one, a wrong split hides that a price changed.${documentContext}

For every line, work \`nameBasis\` through this procedure FIRST, then emit the rest — naming the same way every time is what keeps two passes over the same document consistent:
1. OBSERVE — restate what this line actually covers or sells, reading ALL of its context together: its title, its remarks/conditions, the section it sits under, and the document context above. Never name from the title alone. If the document lays out an explicit outline — a numbered/headed section containing several lettered or indented priced sub-lines that share that header — treat the section as ONE concept and each sub-line as a TIER of it; let the document's own grouping drive the canonical/tier boundaries rather than re-deriving them from wording. (A shared section banner alone never forces a merge, and a genuine price/unit-basis conflict still splits concepts.)
2. CONCEPT — from that observation, name what the service fundamentally IS in the fewest words (2 to 4 tokens), ignoring price, size, quantity, location, and every other qualifier → \`canonicalName\`. Same-concept lines share ONE name even when their wording differs and even when the registry below is empty; but keep genuinely different priced services apart even when their wording is similar — a wrong merge collapses two distinct rates.
3. AXIS — find the ONE qualifier whose value is why THIS line's price differs from its siblings under that concept, named at the COARSEST grain that still separates it from the sibling bands → \`tier\` + \`tierSlug\` (both null for a single flat rate). When sub-lines sit under a shared section header, the tier axis is whatever distinguishes each sub-line within that section (e.g. cargo type, coverage sub-type); name the tier from that.
4. REUSE — check the registry below: if the concept matches an existing canonical, reuse that EXACT name; if the band matches a listed slug, reuse that EXACT slug. Never mint a near-duplicate.

Then (each field's exact format is in its description):
- Emit ONE entry PER TIER of a tiered rate, all sharing the SAME canonicalName. Drop grand-total, subtotal, and pure recap rows.
- attributes — extract exactly these keys; numeric values are digits only (no currency symbols, no commas):
${attrLines}

Existing canonical services for this vendor (with their known tier slugs):
${registry}

Return an empty services array only if this chunk has no priced lines.\n${namingBlock}\n${rulesBlock}`;
}

export interface ServicePromptContext {
  set: AttributeSet;
  runningCanonicals: CanonicalRegistryEntry[];
  runningTiers: TierRegistryEntry[];
  metadata: DocumentMetadata; // document-level context for this chunk
  rules?: string; // vendor guardrail rules for this phase; undefined = none
}

export const SERVICE_EXTRACT_PROMPT: PromptTemplate<ServicePromptContext> = {
  id: 'service.extract',
  version: 'v1',
  render: ({ set, runningCanonicals, runningTiers, metadata, rules }) =>
    buildServiceSystemPrompt(
      set,
      runningCanonicals,
      runningTiers,
      metadata,
      rules,
    ),
};

// ── Save-time canonical re-match ──────────────────────────────────────────────
// When a reviewer edits a line's concept-bearing fields (title / pricingContext),
// its canonical grouping can change. saveServices re-resolves those lines against
// the vendor's existing registry. Assignment shape is fixed (attribute-set agnostic).

export function buildCanonicalMatchSchema() {
  return z.object({
    assignments: z
      .array(
        z.object({
          id: z.string().describe('The line id, echoed back verbatim.'),
          nameBasis: z
            .string()
            .describe(
              'Scratch space: your one-line application of the naming procedure — concept, then distinguishing axis, then band grain. Fill this FIRST; it is discarded after matching.',
            ),
          canonicalName: z
            .string()
            .describe(
              'Normalized vendor-agnostic concept name, lowercase snake_case (e.g. "customs_clearance"); no tier/price. Reuse an existing registry name when the concept matches.',
            ),
          canonicalDescription: z
            .string()
            .describe(
              'One-line description of what this canonical service is.',
            ),
          tierSlug: z
            .string()
            .nullable()
            .describe(
              'Normalized snake_case band id for this line (e.g. "20ft", "5_20_skus"), 1-3 tokens naming the distinguishing axis value at the COARSEST grain that still separates it from the sibling bands — a subcategory, never a verbatim member list, never so broad it collides; the SAME slug for the same band across lines/docs — reuse a slug listed under the matching canonical when it is that band; null if this line is a single flat rate with no band.',
            ),
        }),
      )
      .describe('Exactly one assignment per input line, keyed by its id.'),
  });
}

export type CanonicalMatchResult = z.infer<
  ReturnType<typeof buildCanonicalMatchSchema>
>;

export interface CanonicalMatchContext {
  set: AttributeSet;
  registry: CanonicalRegistryEntry[];
  tiers: TierRegistryEntry[];
  rules?: string; // vendor guardrail rules for this phase; undefined = none
}

export function buildCanonicalMatchPrompt(
  set: AttributeSet,
  registry: CanonicalRegistryEntry[],
  tiers: TierRegistryEntry[],
  rules?: string,
): string {
  const lines = renderRegistry(registry, tiers, SERVICE_REGISTRY_EMPTY_MESSAGE);

  // The reuse rule is data-driven: a set may carry a vertical-specific override (e.g.
  // insurance's amendment-chain reuse); everything else uses the generic default. The
  // tie-break favours a listed name over a near-synonym you would mint.
  const reuseRule =
    set.reuseGuidance ??
    'Reuse one of the existing canonical services below when the line is that concept — a listed name always wins over a near-synonym you would mint (never create a new name that differs from a listed one only by synonyms, plurals, or word order); otherwise mint a new normalized name and give it a one-line canonicalDescription.';

  const namingBlock = renderNamingBlock(set);
  const rulesBlock = renderRulesBlock(rules);

  return `${set.promptContext}

You assign each ${set.label} service line to a canonical concept and a tier band — the schema field descriptions define each field's exact format; follow them. Your output feeds a knowledge graph that links the same service across many of this vendor's documents over time: canonicalName is the stable identifier used to match a line to its earlier versions, so a consistent, accurate name lets a new rate correctly supersede the old one — a wrong merge collapses two distinct rates into one, a wrong split hides that a price changed.

The user message is a table of lines (id, title, tier, pricingContext, sectionContext, attributes) that a reviewer just edited.

For each line, work \`nameBasis\` through this procedure FIRST, then emit the assignment — naming the same way every time is what keeps this pass consistent with the extraction pass and with other documents:
1. OBSERVE — restate what this line actually covers, reading ALL of its context together: its title, tier, pricingContext, attributes, and its sectionContext (a section-level qualifier scoping the chunk, e.g. a validity window or zone/mode restriction). Never name from the title alone.
   - Lines under DIFFERENT sectionContext are usually distinct services/bands — do not collapse them onto one canonical + tier on wording alone.
   - Conversely, lines sharing ONE sectionContext (a section header they were extracted under) are usually sub-lines of that section: lean toward ONE canonical with each line a TIER keyed on what distinguishes it within the section, unless a price/unit-basis conflict says otherwise.
   - Use each existing canonical's contracted price/unit (shown below) as a tie-break BOTH ways: when a line's CONCEPT and price/unit basis match an existing canonical, reuse that name even across a different section (a section banner alone — e.g. one department vs another — never justifies a near-duplicate name for the same fee); conversely a clear price/unit-basis conflict is real evidence the concepts differ.
2. CONCEPT — from that observation, name what the service fundamentally IS in the fewest words (2 to 4 tokens), ignoring price, size, quantity, location, and every other qualifier → \`canonicalName\`. Same-concept lines share ONE name even when their wording differs and even when the registry below is empty; keep genuinely different priced services apart even when their wording is similar.
3. AXIS — find the ONE qualifier whose value is why this line's price differs from its siblings under that concept, named at the COARSEST grain that still separates it from the sibling bands → \`tierSlug\` (null for a single flat rate).
4. REUSE — ${reuseRule} Existing canonical services for this vendor (with their known tier slugs):
${lines}${namingBlock}${rulesBlock}`;
}

export const CANONICAL_MATCH_PROMPT: PromptTemplate<CanonicalMatchContext> = {
  id: 'service.canonical-match',
  version: 'v1',
  render: ({ set, registry, tiers, rules }) =>
    buildCanonicalMatchPrompt(set, registry, tiers, rules),
};

// ── Cross-service pricing-reference detection ─────────────────────────────────
// After canonicals are reconciled, some lines price themselves RELATIVE to another
// service ("40% of the customs clearance fee"). This pass identifies those links so
// they can be persisted as PRICED_FROM edges and composed at match time. It captures
// only WHICH service is referenced and the verbatim wording — never a fixed factor.

export function buildServiceReferenceSchema() {
  return z.object({
    references: z
      .array(
        z.object({
          fromId: z
            .string()
            .describe(
              'The id of the line whose price is stated relative to ANOTHER service.',
            ),
          referencedCanonical: z
            .string()
            .describe(
              'The canonicalName of the OTHER service this line is priced from — MUST be one of the canonicalNames present in the input list, never a new name.',
            ),
          referencedTierSlug: z
            .string()
            .nullable()
            .describe(
              'The specific tier band of the referenced service when the wording names one AND that service is tiered; null when it is flat or no band is named.',
            ),
          relation: z
            .string()
            .describe(
              'The verbatim relationship phrasing tying this line to the referenced service, e.g. "40% of A", "A plus 10", "A + 5% of value".',
            ),
        }),
      )
      .describe(
        'One entry ONLY for a line whose price is stated relative to another service in the list. Omit every self-contained line — most lines have no reference, so this array is usually empty.',
      ),
  });
}

export type ServiceReferenceResult = z.infer<
  ReturnType<typeof buildServiceReferenceSchema>
>;

export interface ServiceReferenceContext {
  set: AttributeSet;
}

export function buildServiceReferencePrompt(set: AttributeSet): string {
  return `${set.promptContext}

You detect CROSS-SERVICE pricing references. The user message is a table of this vendor's service lines (id, canonicalName, title, pricingContext). A line has a reference when its price is defined in terms of ANOTHER service in the list — e.g. "40% of the documentation fee", "same as customs clearance plus 10", "5% of the freight charge".

Return one entry per referencing line and NOTHING for self-contained lines (a fixed rate, a percentage of a shipment/insured value, a per-unit price — these reference no other service). Rules:
1. \`referencedCanonical\` MUST be an existing canonicalName from the table — the service being referenced. Never invent a name; if the referenced service is not in the table, omit the line.
2. A line never references its OWN canonicalName. Ignore "same as above" wording that points at the same concept.
3. \`relation\` is the verbatim/condensed phrasing of the dependency ("40% of X", "X plus 10") — do not compute or simplify it into a number.
4. When in doubt whether a line truly depends on another service, omit it — a false reference is worse than a missed one.`;
}

export const SERVICE_REFERENCE_PROMPT: PromptTemplate<ServiceReferenceContext> =
  {
    id: 'service.reference-detect',
    version: 'v1',
    render: ({ set }) => buildServiceReferencePrompt(set),
  };
