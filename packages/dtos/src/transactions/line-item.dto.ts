import { ApiProperty } from '@nestjs/swagger';
import type { LineItemMatchKind, LineItemStatus } from '@nom/shared';

// The match model's per-field rationale for a line's matchKind (mirrors the match
// schema's `reasoning` object). Fields not applicable to the kind are "".
export class LineItemReasoningDto {
  @ApiProperty({ description: 'Why this matchKind was chosen.' })
  kind!: string;

  @ApiProperty({ description: 'Why this canonical fits — or why none does. "" if not applicable.' })
  canonical!: string;

  @ApiProperty({ description: 'Why this tier (or flat rate). "" if not applicable.' })
  tier!: string;

  @ApiProperty({ description: 'Why these sibling lines were referenced. "" unless sibling_ref.' })
  references!: string;
}

// Panel header: Expected · Charged · Difference. All null before matching.
export class LineItemReconciliationDto {
  @ApiProperty({ type: Number, nullable: true, description: 'Calculated total (formula over resolved symbols).' })
  expectedAmount!: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'Billed amount from the invoice.' })
  billedAmount!: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'billed − expected. null when either side is null.' })
  difference!: number | null;

  @ApiProperty({
    nullable: true,
    enum: ['over', 'under', 'match'],
    description: 'Sign of the difference for the UI arrow. null before matching.',
  })
  direction!: 'over' | 'under' | 'match' | null;
}

// "From Quotation": the priced rate-card line the charge was matched to. null unless
// service-matched. The rate/premium + unit live in `attributes`.
export class LineItemFromQuotationDto {
  @ApiProperty({ nullable: true, description: 'Verbatim service title of the matched rate-card line.' })
  title!: string | null;

  @ApiProperty({ description: 'Canonical service the line was billed as.' })
  canonicalName!: string;

  @ApiProperty({ nullable: true, description: 'Resolved tier slug on the match.' })
  tierSlug!: string | null;

  @ApiProperty({ nullable: true, description: 'Human tier label of the matched rate-card line.' })
  tier!: string | null;

  @ApiProperty({ nullable: true, description: 'Pricing context of the matched rate-card line.' })
  pricingContext!: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'The matched line\'s priced attribute bag (rate/premium, unit, currency, ...).',
  })
  attributes!: Record<string, string | number | null>;
}

// "How the result was determined": the formula and the values it was evaluated over.
export class LineItemHowDeterminedDto {
  @ApiProperty({ nullable: true, example: 'sum_insured * rate / 100', description: 'Arithmetic expression for the amount.' })
  formula!: string | null;

  @ApiProperty({
    type: 'object',
    nullable: true,
    additionalProperties: { type: 'number', nullable: true },
    description: 'Resolved values for the symbols in `formula`.',
  })
  symbols!: Record<string, number | null> | null;

  @ApiProperty({ type: Number, nullable: true, description: 'Calculated total.' })
  expectedAmount!: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'Billed amount.' })
  billedAmount!: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'billed − expected.' })
  difference!: number | null;
}

// A billed line item as surfaced to the client — from the extract response and the
// graph read endpoint alike, grouped into the reconciliation UI's panel sections.
// `attributes` is the per-attribute-set bag (qty, unit_price, amount, ...). The audit
// trail is NOT included — it is fetched on demand via
// GET .../line-items/:lineItemId/logs (LineItemLogDto).
export class LineItemDto {
  @ApiProperty({ example: 'uuid', description: 'Line item id.' })
  id!: string;

  @ApiProperty({ description: 'Verbatim charge description.' })
  description!: string;

  @ApiProperty({
    example: 'NCCP-2501-041',
    description: 'Invoice this line belongs to (chunk label) — groups bundled invoices.',
  })
  invoiceRef!: string;

  @ApiProperty({ description: 'Chunk label this line was extracted from.' })
  sectionLabel!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Per attribute-set values (quantity, unit_price, amount, ...).',
  })
  attributes!: Record<string, string | number | null>;

  @ApiProperty({
    description: 'Verbatim snippet from the source chunk that identifies this line.',
  })
  sourceText!: string;

  @ApiProperty({
    nullable: true,
    description: 'LLM locator of this line within the chunk, or null.',
  })
  foundAt!: string | null;

  @ApiProperty({
    nullable: true,
    enum: ['match', 'mismatch', 'needs_review', 'accepted'],
    description:
      'Review disposition, set by the match flow. null only before matching; needs_review drives the context-feed flow; accepted is a reviewer override.',
  })
  status!: LineItemStatus | null;

  @ApiProperty({
    nullable: true,
    enum: ['match', 'mismatch', 'needs_review'],
    description:
      'The status this line was accepted from (audit trail). null unless status is accepted.',
  })
  acceptedFrom!: LineItemStatus | null;

  @ApiProperty({
    nullable: true,
    enum: ['service_match', 'sibling_ref', 'unmatched'],
    description:
      'How the line relates to the rate card, set by the match flow. null before matching.',
  })
  matchKind!: LineItemMatchKind | null;

  @ApiProperty({
    type: LineItemReconciliationDto,
    description: 'Expected · Charged · Difference. Fields null before matching.',
  })
  reconciliation!: LineItemReconciliationDto;

  @ApiProperty({
    type: LineItemFromQuotationDto,
    nullable: true,
    description: 'The matched rate-card line ("From Quotation"). null unless service-matched.',
  })
  fromQuotation!: LineItemFromQuotationDto | null;

  @ApiProperty({
    type: LineItemHowDeterminedDto,
    nullable: true,
    description: 'The formula breakdown. null before matching or when no formula.',
  })
  howDetermined!: LineItemHowDeterminedDto | null;

  @ApiProperty({
    nullable: true,
    description:
      'Human-readable explanation of the verdict ("Why the AI reached this conclusion"). null before matching.',
  })
  narrative!: string | null;

  @ApiProperty({
    type: LineItemReasoningDto,
    nullable: true,
    description: "The match model's reasoning for matchKind. null before matching.",
  })
  matchReasoning!: LineItemReasoningDto | null;

  @ApiProperty({
    nullable: true,
    example: 'Needs context: unresolved symbol(s) rate',
    description:
      'needs_review only: plain statement of the missing context; the user supplies it and the flow reruns for this line.',
  })
  reviewNote!: string | null;

  @ApiProperty({
    nullable: true,
    description:
      "The reviewer's persistent per-line guidance (the last correction submitted for this line), re-applied on every rerun. null until any guidance is submitted.",
  })
  guidance!: string | null;

  @ApiProperty({
    type: [String],
    description:
      'Descriptions of the sibling lines this line is computed from (REFERENCES edges). Empty unless sibling_ref.',
  })
  references!: string[];

  @ApiProperty({
    description:
      'Whether this line is subject to tax/GST. Structural — present regardless of attribute set.',
  })
  taxable!: boolean;

  @ApiProperty({
    type: Number,
    example: 9,
    description: 'Tax/GST rate as a percentage (e.g. 9 for "9% GST"); 0 when not taxed.',
  })
  taxPercentage!: number;
}
