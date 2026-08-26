import { z } from 'zod';
import type { AttributeSet } from '../../attribute-set';
import type { PromptTemplate } from '../../infra/llm/prompt.types';
import {
  renderLineItemBlock,
  renderRulesBlock,
} from '../../common/registry-render';

/**
 * Phase 3 of matching — the symbol resolver. After a line is linked to a canonical
 * service + tier, its formula still carries null symbols (the reserved `rate`, filled
 * "later from the rate card"). This prompt reads each null symbol's value off the
 * MATCHED tier in the vendor's rate-card cluster and records where it came from.
 */
export function buildResolveSchema() {
  return z.object({
    lines: z
      .array(
        z.object({
          id: z.string().describe('The line id, echoed back verbatim.'),
          resolvedSymbols: z
            .array(
              z.object({
                name: z
                  .string()
                  .describe('The formula symbol being resolved, e.g. "rate".'),
                sourcePath: z
                  .string()
                  .describe(
                    'Find this FIRST — where the value lives: "guidance" when the value is stated in this line\'s reviewerGuidance, "rules" when stated in a vendor rule, "canonical:tierSlug:attrib:<key>" for a rate-card attribute (e.g. "canonical:tierSlug:attrib:price" — the contracted unit rate), or "canonical:tierSlug:pricingContext" for a value read from the pricingContext text. Use "flat" in place of the slug when the tier is untiered; "unresolved" when not found.',
                  ),
                value: z
                  .number()
                  .nullable()
                  .describe(
                    'The numeric value read from that source; null when sourcePath is "unresolved".',
                  ),
              }),
            )
            .describe(
              'One entry per currently-null symbol in this line\'s formula, plus any non-null symbol the line\'s reviewerGuidance explicitly restates with a different value (sourcePath "guidance").',
            ),
        }),
      )
      .describe('Exactly one entry per input line, keyed by its id.'),
  });
}

export type ResolveResult = z.infer<ReturnType<typeof buildResolveSchema>>;
export type ResolvedLine = ResolveResult['lines'][number];
export type ResolvedSymbol = ResolvedLine['resolvedSymbols'][number];

export interface ResolvePromptContext {
  set: AttributeSet;
  cluster: string;
  rules?: string; // vendor guardrail rules for this phase; undefined = none
}

export function buildResolveSystemPrompt(ctx: ResolvePromptContext): string {
  // Vertical-specific line-item rules from the attribute set, then vendor rules
  // last so they read as overrides. Empty → no block, prompt byte-identical to default.
  const lineItemBlock = renderLineItemBlock(ctx.set);
  const rulesBlock = renderRulesBlock(ctx.rules);
  return `${ctx.set.promptContext}

You resolve the unknown symbols in billed line-item formulas. The user message is a table of lines — each row has an id, description, its matched canonicalName + tierSlug (empty "—" when the line has no rate-card match), a "formula", "symbols" (a flattened name=value list; a "—" value is unresolved), and, when present, a "reviewerGuidance" column (a human reviewer's correction that may state the contracted rate or another value directly).

Work top to bottom; per-field format (the sourcePath vocabulary, value handling) lives in each field's description.

1. RESOLVE IN PRECEDENCE — for each symbol whose value is null, take the first source that states it: (a) the line's own \`reviewerGuidance\`; (b) the vendor rules block below; (c) that line's MATCHED tier in the rate card. The reserved "rate" symbol is the contracted unit rate — read it directly from the matched tier's unit-price attribute (commonly keyed \`price\`, also \`unit_price\` or \`rate\`); use the tier's pricingContext text only when the tier has no such attribute. An untiered match shows tierSlug "flat" and resolves \`rate\` from that service's "flat" entry in the rate card below — a flat tier is still a MATCH, not a missing one.
2. NO MATCH — "no rate-card match" is signalled ONLY by an empty ("—") canonicalName, never by a flat/empty tierSlug. Such a line resolves its symbols only from \`reviewerGuidance\` or the vendor rules. Never guess a number that is not stated in an allowed source; when none states it, set \`value\` null and \`sourcePath\` "unresolved".
3. SCOPE — only resolve symbols already present in the line's \`symbols\`; never invent new names, and leave non-null symbols untouched. ONE exception: if the line's own \`reviewerGuidance\` states a DIFFERENT value for a symbol that already has one, return it with sourcePath "guidance" and the corrected value. Rules and the rate card never overwrite an existing value.

Vendor rate card (current services, by canonical; may be empty when a line has no match):
${ctx.cluster}${lineItemBlock}${rulesBlock}`;
}

export const LINE_ITEM_RESOLVE_PROMPT: PromptTemplate<ResolvePromptContext> = {
  id: 'transaction.line-item.resolve',
  version: 'v1',
  render: buildResolveSystemPrompt,
};
