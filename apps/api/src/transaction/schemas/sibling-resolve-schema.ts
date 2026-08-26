import type { AttributeSet } from '../../attribute-set';
import type { PromptTemplate } from '../../infra/llm/prompt.types';
import {
  renderLineItemBlock,
  renderRulesBlock,
} from '../../common/registry-render';

/**
 * Phase 3b of matching — the sibling symbol resolver. A sibling_ref line's amount is
 * computed from OTHER lines in the same invoice (a percentage or handling fee over other
 * rows), so its null formula symbols (e.g. `base`) are read from the referenced siblings'
 * billed amounts rather than the rate card. Output shape is shared with the rate-card
 * resolver (`buildResolveSchema` in resolve-schema.ts); only the prompt differs.
 * No cycle risk: inputs are the siblings' billed amounts (known from the invoice),
 * never their computed/expected amounts.
 */

export interface SiblingResolvePromptContext {
  set: AttributeSet;
  rules?: string; // vendor guardrail rules for this phase; undefined = none
}

export function buildSiblingResolveSystemPrompt(
  ctx: SiblingResolvePromptContext,
): string {
  // Vertical-specific line-item rules from the attribute set, then vendor rules
  // last so they read as overrides. Empty → no block, prompt byte-identical to default.
  const lineItemBlock = renderLineItemBlock(ctx.set);
  const rulesBlock = renderRulesBlock(ctx.rules);
  return `${ctx.set.promptContext}

You resolve the unknown symbols in billed line-item formulas whose amounts are computed from OTHER lines in the same invoice. The user message is a table of such lines — each row has an id, description, a "formula", "symbols" (a flattened name=value list; a "—" value is unresolved), and "references": the sibling lines this charge is computed from, each with its id, description, and billed amount.

Work top to bottom; per-field format lives in each field's description.

1. DERIVE — for each symbol whose value is null, derive it from that line's referenced siblings' billed amounts: typically their sum, but use a single sibling's amount or a subset sum when the description says so.
2. SOURCE — sourcePath records where you derived it (locate the source FIRST): "sibling:<lineId>" for a single sibling's amount, or "sum(sibling:<id>, ...)" for a sum. If it cannot be derived from the referenced amounts, set \`value\` null and \`sourcePath\` "unresolved" — never guess a number not derivable from the listed amounts.
3. SCOPE — only resolve symbols already present with a null value; never invent new symbol names, and leave non-null symbols untouched.${lineItemBlock}${rulesBlock}`;
}

export const LINE_ITEM_SIBLING_RESOLVE_PROMPT: PromptTemplate<SiblingResolvePromptContext> =
  {
    id: 'transaction.line-item.sibling-resolve',
    version: 'v1',
    render: buildSiblingResolveSystemPrompt,
  };
