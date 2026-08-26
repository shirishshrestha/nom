import { z } from 'zod';
import { LINE_ITEM_MATCH_KINDS } from '@nom/shared';
import type { DocumentMetadata } from '@nom/shared';
import type { AttributeSet } from '../../attribute-set';
import { describeAttributes } from '../../attribute-set';
import type { PromptTemplate } from '../../infra/llm/prompt.types';
import type {
  CanonicalRegistryEntry,
  TierRegistryEntry,
} from '../../infra/graph/canonical-registry.repository';
import type { CanonicalServiceGroup } from '../../infra/graph/service-graph.repository';
import {
  renderRegistry,
  renderLineItemBlock,
  renderRulesBlock,
  renderDocumentContext,
  REGISTRY_NAMING_HINT,
} from '../../common/registry-render';

/**
 * Dynamic structured-output schema + system prompt for line-item extraction. The
 * attribute bag is generated from the AI-detected attribute set (invoice / endorsement),
 * so nothing about the billed-line shape is hardcoded per document type.
 *
 * Phase 1 of matching happens HERE: the model is given the vendor's canonical registry
 * and assigns each line an `initial*` guess — service_match (a canonical it bills),
 * sibling_ref (computed from other lines in the same invoice), or unmatched. The
 * sibling line UUIDs do not exist yet at extraction time, so a sibling reference is
 * captured as free text (`initialRefSummary`); the reconciler resolves it to ids later.
 */

export function buildLineItemSchema(set: AttributeSet) {
  const { schema: attributesSchema } = describeAttributes(set);
  const item = z.object({
    description: z
      .string()
      .describe(
        'The billed charge name, verbatim — the charge cell only, excluding the S/No and any amounts. Join a description that wraps across printed rows into one string.',
      ),
    foundAt: z
      .string()
      .nullable()
      .describe(
        'A short locator for where this line sits (e.g. its S/No or row label), or null.',
      ),
    sourceText: z
      .string()
      .describe(
        'The verbatim snippet copied from this chunk that identifies this billed line (for highlighting in the review UI).',
      ),
    attributes: attributesSchema.describe(
      `Billed values for this line (${set.key} attribute set).`,
    ),
    matchBasis: z
      .string()
      .describe(
        'Scratch space: one line applying the match procedure — the service concept this line bills, its price-determining qualifier, then the registry canonical + tier slug that selects (or the sibling lines it is computed from, or "none"). Fill this FIRST; it is discarded after extraction.',
      ),
    initialKind: z
      .enum([
        LINE_ITEM_MATCH_KINDS.SERVICE_MATCH,
        LINE_ITEM_MATCH_KINDS.SIBLING_REF,
        LINE_ITEM_MATCH_KINDS.UNMATCHED,
      ])
      .describe(
        'How this line relates to the rate card: "service_match" (it bills a canonical service below), "sibling_ref" (its amount is computed from OTHER lines in this same invoice, e.g. "5% of PSA & Depot"), or "unmatched".',
      ),
    initialCanonical: z
      .string()
      .nullable()
      .describe(
        'For service_match: the exact canonicalName from the registry this line bills — never a name not listed there. null otherwise (use "unmatched" when nothing fits).',
      ),
    initialTierSlug: z
      .string()
      .nullable()
      .describe(
        'For service_match: the matched tier slug (e.g. "20ft", "40ft") when the canonical is tiered; null for flat rates or non-matches.',
      ),
    initialRefSummary: z
      .string()
      .nullable()
      .describe(
        'For sibling_ref: name the OTHER line(s) in THIS invoice this charge is computed from, by their description (e.g. "PSA 40\' LOLO and Depot Handling Charge"). null otherwise.',
      ),
    taxable: z
      .boolean()
      .describe(
        'true if this line is subject to tax/GST (e.g. a "9% GST" or taxable "(T)" line); false if not taxed, out-of-scope "(OS)", or zero-rated. Decide from the line\'s own tax indicator even when the attribute set has no tax field.',
      ),
    taxPercentage: z
      .number()
      .nullish()
      .describe(
        'The tax/GST rate applied to this line as a percentage number (e.g. 9 for "9% GST"). Optional — omit or 0 when the line is not taxed.',
      ),
    formula: z
      .string()
      .describe(
        'Pure-arithmetic expression whose result reproduces this line\'s billed total attribute, e.g. "rate * quantity". Use the reserved symbol "rate" for the contracted unit rate — do NOT inline the billed unit price. Match the tax basis of that total: include a tax factor (e.g. "* (1 + gst)") only when the billed total is tax-inclusive; otherwise keep tax in taxable/taxPercentage. Resolve any condition into a numeric symbol value; never write "if". Operators: + - * / ( ).',
      ),
    symbols: z
      .array(
        z.object({
          name: z.string().describe('Symbol used in `formula`.'),
          value: z
            .number()
            .nullable()
            .describe(
              "The symbol's value read from THIS invoice. Set null only for `rate` (resolved later from the rate card).",
            ),
        }),
      )
      .describe(
        'Every symbol appearing in `formula`, with its invoice value. Always include `rate` with value null.',
      ),
  });
  return z.object({
    lineItems: z
      .array(item)
      .describe(
        'One entry per billed charge line. Drop Sub-Total / tax / Grand-Total / summary rows.',
      ),
    sectionContext: z
      .string()
      .nullable()
      .describe(
        'ALL section-level text that scopes the lines in THIS invoice/chunk and is NOT already captured in a line item — e.g. a bill/coverage period, a location, a section banner, or any section-wide note/term/condition (e.g. "Bill Period: Balance Stock (Feb 2025)"). Captured once, VERBATIM — do not condense, summarise, or truncate; concatenate multiple section-level fragments in document order. Null only if the chunk carries no such section-level text.',
      ),
  });
}

export type LineItemExtractionResult = z.infer<
  ReturnType<typeof buildLineItemSchema>
>;
export type ExtractedLineItem = LineItemExtractionResult['lineItems'][number];

/**
 * Plain-text dump of a vendor's current rate-card cluster: every canonical, each of
 * its current tiers, and ALL of that tier's node props (attributes + pricingContext)
 * inline. Iterates the attribute bag so new/dynamic keys come along automatically —
 * the SymbolResolver reads contracted values (e.g. `rate`) out of this blob. Not JSON;
 * human-readable so the model can cite a source path (canonical:tierSlug:attrib:<key>).
 */
// ponytail: serviceId/tenantId are the committed Attributes node's MERGE keys and
// attributeSet its set field (see COMMIT_SERVICES_CYPHER) — plumbing, not pricing. They
// leak through properties(a); drop them so the resolver sees only real rate attributes.
const INTERNAL_ATTRIBUTE_KEYS = new Set([
  'serviceId',
  'tenantId',
  'attributeSet',
]);

export function renderRateCardCluster(groups: CanonicalServiceGroup[]): string {
  if (!groups.length)
    return '   (none — this vendor has no committed rate-card services)';
  return groups
    .map((g) => {
      const head = `- "${g.canonicalName}"${g.canonicalDescription ? ` — ${g.canonicalDescription}` : ''}`;
      const tiers = g.services
        .map((s) => {
          const slug = s.tierSlug ?? 'flat';
          const attrs = Object.entries(s.attributes ?? {})
            .filter(([k]) => !INTERNAL_ATTRIBUTE_KEYS.has(k))
            .map(([k, v]) => `${k}=${v ?? ''}`)
            .join(', ');
          const parts = [
            s.tier ? `tier "${s.tier}"` : null,
            `slug ${slug}`,
            attrs ? `attrib: ${attrs}` : null,
            s.pricingContext ? `pricingContext: ${s.pricingContext}` : null,
          ].filter(Boolean);
          return `    · ${parts.join(' · ')}`;
        })
        .join('\n');
      return tiers ? `${head}\n${tiers}` : head;
    })
    .join('\n');
}

/**
 * The global procedure for one invoice chunk. Per-field mechanics (formula tax basis,
 * symbols, sectionContext, drop-totals, etc.) live in the schema field descriptions —
 * those are sent to the model as the tool schema, so they are not repeated here. This
 * block carries only what is cross-field, procedural, or dynamic (the registry, the
 * attribute keys, the vertical formula shapes). `attrLines` is the per-attribute
 * instruction list (from describeAttributes).
 */
function lineItemExtractionRules(
  attrLines: string,
  registry: string,
  namingHint: string,
): string {
  return `1. EMIT — one entry per billed charge line; join a description wrapped across printed rows into one line. Drop every Sub-Total, tax, Grand-Total, and summary/recap row — those totals are captured separately as document metadata. Return an empty lineItems array only when the chunk has no charge lines.
2. ATTRIBUTES — extract exactly these keys; numeric values are digits only, no currency symbol or thousands separators ("$220.000" → 220, "1,228.87" → 1228.87):
${attrLines}
3. CLASSIFY each line against the rate card — fill \`matchBasis\` FIRST, then the initial* fields. Match by MEANING, not surface text — an acronym matches a canonical only when the token is IDENTICAL; a near, substring, or superstring acronym is a DIFFERENT service, and when only a near-acronym corroborates use "unmatched" rather than forcing the match. The vendor's canonical services (with known tier slugs):
${registry}${namingHint}
4. FORMULA — shape depends on the vertical (flat per-unit, percentage-of-a-base, sibling-derived); follow the shapes and examples under "Line-item rules for this document type" below.`;
}

export interface LineItemPromptContext {
  set: AttributeSet;
  registry: CanonicalRegistryEntry[];
  tiers: TierRegistryEntry[];
  metadata: DocumentMetadata; // document-level context for this chunk
  rules?: string; // vendor guardrail rules for this phase; undefined = none
}

/** System prompt for one invoice chunk's line-item extraction + initial match. */
export function buildLineItemSystemPrompt(ctx: LineItemPromptContext): string {
  const { promptLines } = describeAttributes(ctx.set);
  const registry = renderRegistry(
    ctx.registry,
    ctx.tiers,
    '(none yet — this vendor has no rate-card services; classify every line as "unmatched" or "sibling_ref")',
  );
  const namingHint = ctx.registry.length ? `\n${REGISTRY_NAMING_HINT}` : '';

  const documentContext = renderDocumentContext(ctx.metadata);
  // Vertical-specific line-item rules from the attribute set, then vendor
  // rules last so they read as overrides. Empty → no block, so the
  // prompt is byte-identical to the neutral default.
  const lineItemBlock = renderLineItemBlock(ctx.set);
  const rulesBlock = renderRulesBlock(ctx.rules);

  return `${ctx.set.promptContext}

You receive ONE invoice (one chunk) from a transaction document. Extract every billed charge line into the required structure, and classify how each line relates to the vendor's rate card.${documentContext}

Work top to bottom; per-field format lives in each field's description.

${lineItemExtractionRules(promptLines, registry, namingHint)}${lineItemBlock}${rulesBlock}`;
}

export const LINE_ITEM_EXTRACT_PROMPT: PromptTemplate<LineItemPromptContext> = {
  id: 'transaction.line-item.extract',
  version: 'v1',
  render: buildLineItemSystemPrompt,
};
