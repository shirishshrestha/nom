import { z } from 'zod';
import { LINE_ITEM_MATCH_KINDS } from '@nom/shared';
import type { DocumentMetadata } from '@nom/shared';
import type { AttributeSet } from '../../attribute-set';
import type { PromptTemplate } from '../../infra/llm/prompt.types';
import type {
  CanonicalRegistryEntry,
  TierRegistryEntry,
} from '../../infra/graph/canonical-registry.repository';
import {
  renderRegistry,
  renderLineItemBlock,
  renderRulesBlock,
  renderDocumentContext,
  REGISTRY_NAMING_HINT,
} from '../../common/registry-render';

/**
 * Phase 2 of matching — the Haiku reconciler. It re-judges one invoice section's
 * worth of already-extracted line items, now that every line has a stable UUID. The
 * model validates the extraction-time `initial*` guess and, crucially, resolves a
 * sibling reference's free-text summary into the actual sibling line ids in the same
 * section (those ids did not exist when the line was first extracted).
 */
export function buildMatchSchema() {
  return z.object({
    matches: z
      .array(
        z.object({
          id: z.string().describe('The line id, echoed back verbatim.'),
          reasoning: z
            .object({
              kind: z
                .string()
                .describe(
                  'Why this kind (service_match / sibling_ref / unmatched) was chosen.',
                ),
              canonical: z
                .string()
                .describe(
                  'Why this canonicalName fits — or why none does. "" if not applicable.',
                ),
              tier: z
                .string()
                .describe(
                  'Why this tierSlug (or null / flat rate). "" if not applicable.',
                ),
              references: z
                .string()
                .describe(
                  'Why these sibling ids are the ones this line is computed from. "" if not a sibling_ref.',
                ),
              formula: z
                .string()
                .describe(
                  'Why the formula is correct — or what was wrong and how you fixed it. "" if the formula was echoed unchanged.',
                ),
            })
            .describe('Per-field reasoning, decided BEFORE the fields below.'),
          kind: z
            .enum([
              LINE_ITEM_MATCH_KINDS.SERVICE_MATCH,
              LINE_ITEM_MATCH_KINDS.SIBLING_REF,
              LINE_ITEM_MATCH_KINDS.UNMATCHED,
            ])
            .describe(
              'Final classification: "service_match" (bills one registry canonical below), "sibling_ref" (amount computed from OTHER lines in this invoice), or "unmatched".',
            ),
          canonicalName: z
            .string()
            .nullable()
            .describe(
              'For service_match: the exact canonicalName from the registry — never a name not listed there. null otherwise (use "unmatched" when nothing fits).',
            ),
          tierSlug: z
            .string()
            .nullable()
            .describe(
              'For service_match: the matched tier slug, or null for a flat rate / non-match.',
            ),
          referencedIds: z
            .array(z.string())
            .describe(
              "For sibling_ref: the ids of the OTHER lines in this section this charge is computed from — never the line's own id. Empty for service_match / unmatched.",
            ),
          formula: z
            .string()
            .nullable()
            .describe(
              'The corrected pure-arithmetic formula for this line if the given one is malformed or does not reproduce the billed total; otherwise echo it back unchanged. null only if the line genuinely has no formula. Operators: + - * / ( ).',
            ),
          symbols: z
            .array(
              z.object({
                name: z.string().describe('Symbol used in `formula`.'),
                value: z
                  .number()
                  .nullable()
                  .describe(
                    "The symbol's value read from THIS invoice. null for `rate` and any value resolved later from the rate card.",
                  ),
              }),
            )
            .describe(
              'Every symbol appearing in `formula`, with its invoice value. Always include `rate` with value null. Empty when the line has no formula.',
            ),
        }),
      )
      .describe('Exactly one match per input line, keyed by its id.'),
  });
}

export type MatchResult = z.infer<ReturnType<typeof buildMatchSchema>>;
export type LineMatch = MatchResult['matches'][number];
export type MatchReasoning = LineMatch['reasoning'];

export interface MatchPromptContext {
  set: AttributeSet;
  registry: CanonicalRegistryEntry[];
  tiers: TierRegistryEntry[];
  metadata: DocumentMetadata; // document-level context for this invoice
  rules?: string; // vendor guardrail rules for this phase; undefined = none
  today?: string; // current date (YYYY-MM-DD) to anchor relative dates in reviewer guidance
}

export function buildMatchSystemPrompt(ctx: MatchPromptContext): string {
  const registry = renderRegistry(
    ctx.registry,
    ctx.tiers,
    '(none yet — this vendor has no rate-card services; classify every line as "unmatched" or "sibling_ref")',
  );
  const documentContext = renderDocumentContext(ctx.metadata);
  const namingHint = ctx.registry.length ? `\n${REGISTRY_NAMING_HINT}` : '';
  // Vertical-specific line-item rules from the attribute set, then vendor rules
  // last so they read as overrides. Empty → no block, prompt byte-identical to default.
  const lineItemBlock = renderLineItemBlock(ctx.set);
  const rulesBlock = renderRulesBlock(ctx.rules);
  // renderRulesBlock already carries the date when rules exist; add it here only for the
  // guidance-without-rules case so a reviewer's relative date range still anchors.
  const dateBlock =
    !ctx.rules && ctx.today ? `\n\nToday's date is ${ctx.today}.` : '';
  return `${ctx.set.promptContext}

You reconcile the billed line items of ONE invoice against the vendor's rate card. The user message is a table of lines from that invoice — each row has an id, description, sectionContext, attributes, the extractor's first-pass guess (initialKind / initialCanonical / initialTierSlug / initialRefSummary), and its current formula + symbols. sectionContext is an invoice/section-level qualifier (e.g. a bill period or coverage period) scoping the line; use it as disambiguating intent — a line under a specific period/scope should match the service that applies to it, and lines under DIFFERENT sectionContext are not assumed to be the same billed fact. All lines of this invoice are present, so you can resolve references between them.${documentContext}

Work top to bottom; decide every reasoning field before the matching field it explains.

1. AUTHORITIES — read first; they override the reading below.
   - reviewerGuidance on a line is a human's authoritative correction of a prior wrong result for THAT line: follow it over your own reading and the initial* guess.
   - A vendor rule that names a scope is authoritative for the lines in that scope: apply the classification it mandates over the surface description and the initial* guess, and NEVER use the billed amount or a rate calculation to judge whether the rule is "warranted" (amounts are verified downstream, not here). It governs ONLY the lines meeting that scope — never carry its adjustment (a tax factor, surcharge, or formula change) onto a line it does not name.

2. IDENTIFY the service — by MEANING, never surface text.
   - Concept: strip the description to the bare service concept; note the ONE qualifier that determines its price.
   - Candidates: list the registry canonicals that fit that concept; the price qualifier picks the tier. Trust initialCanonical only when it names a registry entry AND is a genuine concept match. An acronym matches only when the token is IDENTICAL — one differing by a letter, or a substring/superstring acronym (CDMS vs CMS), is a DIFFERENT service.
   - Break ties by RATE: each registry entry shows its contracted price/unit (a tier's pricingContext, or a flat service's attributes, e.g. "flat (price=0.6, unit=per D/O)"). Compare the line's billed unit rate — its \`rate\` symbol, or the rate in its description/attributes — to each candidate that exposes a DIRECT numeric rate: pick the one whose contracted price matches; if the only candidate's rate is grossly inconsistent (off by an order of magnitude) and the fit rests on word similarity alone, classify "unmatched" rather than force-fit; a MODEST difference is NOT grounds to reject — that over/undercharge is exactly what this reconciliation surfaces, so match and let the amounts compare downstream.
   - A candidate whose price is DERIVED from another service (its pricingContext states a relation like "40% of X", not a number) has no rate visible here: do NOT compute or estimate it, and NEVER reject it because the billed rate differs from a number you derived — identify it by concept and rule; its price is composed downstream.
   - No canonical fits: check whether the amount is computed from OTHER lines of this invoice (sibling_ref, via initialRefSummary); otherwise unmatched.

3. FIX the formula — only after identity is settled.
   - Validate the given formula against the description + attributes. If it is malformed (unbalanced parentheses, illegal characters, an undeclared symbol, a leading/trailing operator) OR does not reproduce the billed total, return a CORRECTED formula + full symbol declarations; else echo both unchanged. DECLARE ONLY — the rate card is not available here: keep the contracted unit rate as symbol "rate" with value null, set every rate-card-derived symbol null, inline only values read from THIS invoice, and NEVER change a symbol that already has a value (fix structure, add, or drop symbols only).
   - Tax basis: the formula must reproduce the line's printed amount AS BILLED. Following the industry norm that printed line amounts are net (tax-exclusive), ALWAYS DEFAULT to no tax factor — even when the line carries a taxable flag, a tax rate, or a separate tax line/column — unless a reviewerGuidance or vendor rule explicitly instructs you to include tax on that line.

Per-field output rules live in each field's description; emit exactly one match per input line.

Existing canonical services for this vendor (with their known tier slugs):
${registry}${namingHint}${lineItemBlock}${rulesBlock}${dateBlock}`;
}

export const LINE_ITEM_MATCH_PROMPT: PromptTemplate<MatchPromptContext> = {
  id: 'transaction.line-item.match',
  version: 'v2',
  render: buildMatchSystemPrompt,
};
