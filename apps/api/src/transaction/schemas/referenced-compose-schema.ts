import { z } from 'zod';
import type { AttributeSet } from '../../attribute-set';
import type { PromptTemplate } from '../../infra/llm/prompt.types';

/**
 * Phase 3c of matching — the referenced-expression composer. A line billed as a service
 * whose price DERIVES from another ("B = 40% of A", where "A = 1% of total value") cannot
 * be resolved by reading a single rate off one tier: its charge is a small expression over
 * another service's charge and a base value. This prompt asks the model to REWRITE the
 * line's formula to encode that chain and to source each symbol — the model produces the
 * symbolic expression only; the arithmetic stays deterministic (evaluated downstream).
 */
export function buildComposeSchema() {
  return z.object({
    lines: z
      .array(
        z.object({
          id: z.string().describe('The line id, echoed back verbatim.'),
          formula: z
            .string()
            .nullable()
            .describe(
              'The REWRITTEN pure-arithmetic expression (only + - * / and parentheses, numeric literals, and symbol names) that encodes this line\'s cross-service pricing chain, with EVERY factor kept as its own symbol and the original scaling preserved — e.g. "sum_insured * main_rate * contingency_factor / 100" for "40% of the main marine rate" (main_rate read verbatim from the referenced tier, contingency_factor = 0.40 from the relation), or "base * ref_rate + flat" for an additive relation. Keep any invoice-known symbol the charge still multiplies (e.g. "quantity"). Null when the relationship cannot be expressed from the available context.',
            ),
          symbols: z
            .array(
              z.object({
                name: z
                  .string()
                  .describe(
                    'A symbol used in the rewritten formula, one per distinct quantity — e.g. "base", "main_rate", "contingency_factor", "quantity". Keep each factor separate; never fold two into one.',
                  ),
                value: z
                  .number()
                  .nullable()
                  .describe(
                    'Its numeric value, read VERBATIM as printed in its source — a rate attribute like premium=0.1 stays 0.1; a relation "40%" becomes the factor 0.40. NEVER rescale or pre-multiply: keep the original formula\'s scaling operator (e.g. "/ 100") so the system applies it. null when the value cannot be found (the line then needs review).',
                  ),
                sourcePath: z
                  .string()
                  .describe(
                    'Where the value came from: "attrib:<key>" for a base/total-value read off this line\'s attributes; "<referencedCanonical>:<tierSlug>:attrib:<key>" for a rate read off a SELECTED tier of the referenced service ("flat" as the slug when that service is untiered); "<canonical>:pricingContext" ONLY as a text fallback when the referenced service exposes no numeric rate attribute; "guidance" or "rules" when stated there; "unresolved" when null.',
                  ),
              }),
            )
            .describe(
              'EVERY symbol the rewritten formula uses, each with the value you resolved for it, read verbatim from its source.',
            ),
        }),
      )
      .describe('Exactly one entry per input line, keyed by its id.'),
  });
}

export type ComposeResult = z.infer<ReturnType<typeof buildComposeSchema>>;
export type ComposedLine = ComposeResult['lines'][number];

export interface ComposePromptContext {
  set: AttributeSet;
  cluster: string; // the rendered rate-card cluster of the billed AND referenced services
  rules?: string; // vendor guardrail rules for this phase; undefined = none
}

export function buildComposeSystemPrompt(ctx: ComposePromptContext): string {
  const rulesBlock = ctx.rules
    ? `\n\nVendor rules for this document (treat as overrides):\n${ctx.rules}`
    : '';
  return `${ctx.set.promptContext}

You resolve billed line items whose price is DERIVED FROM ANOTHER service. The user message is a table of such lines — each row has an id, description, the canonicalName it was billed as, its current "formula" and "symbols", its numeric "attributes" (candidate base / "total value"), and "references": the pricing dependencies out of the billed service ("<from> is priced from <referenced>: <relation wording>").

Your job, per line: rewrite "formula" into a pure-arithmetic expression that expresses the ACTUAL relationship stated by the references + the services' pricingContext, and give a value for every symbol it uses.

Rules:
1. Read the relationship literally and compose it — multiplicative ("40% of A" → a 0.40 factor), additive ("A plus 10" → "+ 10"), or a mix ("A + 5% of value"). Chain multi-level references ("B = 40% of A", "A = 1% of total value") end to end. Keep EVERY factor as its own symbol — NEVER collapse "X% of Y" into one pre-computed number, and never perform the multiply/divide yourself.
2. Referenced RATE: when a line is priced from another service, that service supplies a numeric rate. Read it from the referenced service's rate attribute (commonly keyed "premium", "price", "rate" or "unit_price") VERBATIM — never from the referencing service's own text — and source it as "<referencedCanonical>:<tierSlug>:attrib:<key>". Fall back to "<referencedCanonical>:pricingContext" only when that service exposes no numeric rate attribute.
3. Tier selection: when the referenced service is TIERED, first pick the tier whose commodity/scope matches THIS line — from the line's description and attributes, the same way a line is matched to a tier — then read that tier's rate. If the reference already names a tier, use it. If no tier clearly matches, set that rate symbol's value null and sourcePath "unresolved".
4. RELATION factor: the relation wording ("40% of …") is a SEPARATE multiplier (40% → 0.40 as a decimal), distinct from the referenced rate — never substitute the referencing service's own "40%" for the rate you read off the referenced tier. Compose them preserving the original formula's scaling: base * referenced_rate * relation_factor / 100.
5. The base / "total value" a percentage applies to is a number on THIS line's attributes — pick it and source it as "attrib:<key>". Read every value VERBATIM as printed; do NOT rescale.
6. Keep any invoice-known symbol the charge is still multiplied by (e.g. quantity) with its existing value. Never invent a symbol you do not use in the formula. Use ONLY + - * / and parentheses — emit the expression and the input numbers; the system evaluates it.
7. When a required number is not stated in any allowed source, set that symbol's value null and sourcePath "unresolved"; if the relationship itself cannot be expressed, set formula null.

Worked example: original formula "sum_insured * rate / 100", relation "40% of the main marine rate", referenced service "ordinary_risks" (TIERED; a "main_voyage_foodstuffs" tier carries premium=0.1) for a foodstuffs consignment → rewrite to "sum_insured * main_rate * contingency_factor / 100" with main_rate=0.1 (source "ordinary_risks:main_voyage_foodstuffs:attrib:premium") and contingency_factor=0.40 (from the "40%" relation). The system then computes 180455 * 0.1 * 0.40 / 100 = 72.18.

Vendor rate card (billed and referenced services, by canonical):
${ctx.cluster}${rulesBlock}`;
}

export const LINE_ITEM_COMPOSE_PROMPT: PromptTemplate<ComposePromptContext> = {
  id: 'transaction.line-item.compose-referenced',
  version: 'v1',
  render: buildComposeSystemPrompt,
};
