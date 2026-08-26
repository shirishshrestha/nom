import { z } from 'zod';
import type { AttributeSet } from '../../attribute-set';
import type { PromptTemplate } from '../../infra/llm/prompt.types';
import { renderRulesBlock } from '../../common/registry-render';

/**
 * Post-reconciliation narrative — a short adjudicator-authored explanation for the
 * reviewer, generated only for lines that diverge (mismatch / needs_review). The clean
 * `match` lines keep the deterministic template in the DTO layer. Fail-soft: an empty or
 * missing narrative falls back to that template.
 */
export function buildNarrativeSchema() {
  return z.object({
    lines: z
      .array(
        z.object({
          id: z.string().describe('The line id, echoed back verbatim.'),
          narrative: z
            .string()
            .describe(
              'A 2–4 sentence explanation for the reviewer of this ONE line, in plain prose: state the billed amount; derive the expected amount from the formula and its resolved symbols (e.g. the contracted rate applied to the declared value); quantify the difference; when billed exceeds expected, hypothesize the most likely cause from the coverage / pricingContext / remarks context (naming it as a possibility, not a fact); and end with a concrete call to action addressed to the vendor. Use the currency implied by the attribute set. Do not invent figures beyond the ones provided.',
            ),
        }),
      )
      .describe('Exactly one entry per input line, keyed by its id.'),
  });
}

export type NarrativeResult = z.infer<ReturnType<typeof buildNarrativeSchema>>;
export type NarrativeLine = NarrativeResult['lines'][number];

export interface NarrativePromptContext {
  set: AttributeSet;
  vendorName: string | null;
  rules?: string; // vendor guardrail rules for this phase; undefined = none
}

export function buildNarrativeSystemPrompt(
  ctx: NarrativePromptContext,
): string {
  const rulesBlock = renderRulesBlock(ctx.rules);
  const vendor = ctx.vendorName ?? 'the vendor';
  return `${ctx.set.promptContext}

You write a brief, factual explanation of a billed line item's reconciliation verdict, for a human reviewer auditing an invoice from ${vendor}. The user message is a table of lines — each row has an id, description, review status (mismatch or needs_review), the "formula" and its resolved "symbols", the "expected" and "billed" amounts and their "difference", the matched rate-card "ratePricing" / "rateAttributes" (the contracted rate/premium, unit, currency — empty when unmatched), the line's own "lineAttributes" (e.g. the declared/insured value), and a "reviewNote" stating any missing context.

Work top to bottom; per-line format (length, structure, the call to action) lives in the schema's narrative field description.

1. GROUND — every number comes from the row (the billed amount, the expected amount, their difference); never compute a new figure the table does not support.
2. MISMATCH — name the discrepancy plainly and, if the billed amount is higher, offer ONE plausible cause drawn from the coverage / pricingContext / remarks / description context, framed as a possibility to confirm — not an assertion.
3. NEEDS_REVIEW — state exactly what is missing (per the reviewNote) and what the reviewer must supply.
4. CLOSE — with a specific next step addressed to ${vendor} (e.g. asking them to confirm or itemize the surplus). Keep the tone neutral and professional.${rulesBlock}`;
}

export const LINE_ITEM_NARRATIVE_PROMPT: PromptTemplate<NarrativePromptContext> =
  {
    id: 'transaction.line-item.narrative',
    version: 'v1',
    render: buildNarrativeSystemPrompt,
  };
