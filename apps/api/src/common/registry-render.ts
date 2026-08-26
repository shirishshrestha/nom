import type { DocumentMetadata } from '@nom/shared';
import type { AttributeSet } from '../attribute-set';
import type {
  CanonicalRegistryEntry,
  TierRegistryEntry,
} from '../infra/graph/canonical-registry.repository';

// ponytail: hard character cap, not summarization — slug + label carry the band's
// identity; pricingContext is disambiguation color and its tail is the token hog.
// Raise it if truncation ever drops a genuinely disambiguating qualifier.
const MAX_TIER_PRICING_CONTEXT = 500;

/**
 * One service's slug + label + pricingContext + priced attributes, braceless. A flat
 * (null-slug) service renders as "flat". pricingContext (basis/conditions/qualifiers) is
 * the disambiguating text a bare canonical name/description can lack; the attributes carry
 * the contracted price/unit so the reader can disambiguate name-similar services by RATE
 * even when they have no tiers.
 */
function renderTier(t: TierRegistryEntry, includeAttributes: boolean): string {
  const ctx =
    t.pricingContext && t.pricingContext.length > MAX_TIER_PRICING_CONTEXT
      ? `${t.pricingContext.slice(0, MAX_TIER_PRICING_CONTEXT)}…`
      : t.pricingContext;
  const attrs =
    includeAttributes && t.attributes
      ? Object.entries(t.attributes)
          .map(([k, v]) => `${k}=${v ?? ''}`)
          .join(', ')
      : '';
  const attrStr =
    attrs.length > MAX_TIER_PRICING_CONTEXT
      ? `${attrs.slice(0, MAX_TIER_PRICING_CONTEXT)}…`
      : attrs;
  const label = [t.label, ctx, attrStr].filter(Boolean).join(': ');
  const slug = t.tierSlug ?? 'flat';
  return label ? `${slug} (${label})` : slug;
}

/**
 * Renders a vendor's canonical registry as a braceless bullet list, each annotated
 * with its known tier slugs, so the model reuses real names/slugs instead of
 * inventing them. Shared by extraction, adjudication, and canonical-match prompts —
 * `emptyMessage` is caller-specific (what to tell the model when there's nothing yet).
 * `includeAttributes` surfaces each service's contracted price/unit for rate-aware
 * matching/dedup — kept OFF for the extraction prompt so a service's price is minted
 * from the source document alone, never anchored to an existing registry price.
 */
export function renderRegistry(
  canonicals: CanonicalRegistryEntry[],
  tiers: TierRegistryEntry[],
  emptyMessage: string,
  includeAttributes = true,
): string {
  if (!canonicals.length) return emptyMessage;
  const slugsByCanonical = new Map<string, string[]>();
  for (const t of tiers) {
    const list = slugsByCanonical.get(t.canonicalName) ?? [];
    list.push(renderTier(t, includeAttributes));
    slugsByCanonical.set(t.canonicalName, list);
  }
  return canonicals
    .map((c) => {
      const slugs = slugsByCanonical.get(c.canonicalName);
      const tierStr = slugs?.length ? ` | tiers: ${slugs.join(', ')}` : '';
      return `- ${c.canonicalName}${c.description ? ` — ${c.description}` : ''}${tierStr}`;
    })
    .join('\n');
}

// Decode hint for the MATCH side (extract initial-match + adjudication): how a registry
// name splits into concept + price-determining qualifier, so a line description can be
// mapped to a canonical + tier systematically. The mint-side rules (how names are formed)
// live in the source prompts; this is the read direction only. Empty registry → omit it
// (the fallback tells the model to classify everything unmatched/sibling_ref).
export const REGISTRY_NAMING_HINT = `How to read the registry names: a canonicalName is the bare service CONCEPT in snake_case — qualifiers (size, band, commodity class, scope) are never part of it; the ONE qualifier that changes the price is the tierSlug. So decompose each line: strip its description to the underlying service concept, ignoring qualifiers — that finds the canonical; then its price-determining qualifier picks the tier slug.`;

// Injection layers keeping shared rule text domain-neutral: the attribute set carries the
// vertical's naming vocabulary/examples, the rules param carries the vendor's runtime rules.
// Empty → no block, so the prompt is byte-identical to the default.
export function renderNamingBlock(set: AttributeSet): string {
  return set.namingGuidance?.trim()
    ? `\n\nNaming rules for this document type:\n${set.namingGuidance.trim()}`
    : '';
}

export function renderLineItemBlock(set: AttributeSet): string {
  return set.lineItemGuidance?.trim()
    ? `\n\nLine-item rules for this document type:\n${set.lineItemGuidance.trim()}`
    : '';
}

// Anchors any relative date range a rule or a reviewer's guidance mentions ("bills after
// March", "last quarter") to the actual current date. ponytail: UTC day — good enough; a
// timezone-exact clock only matters at a midnight boundary.
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function renderRulesBlock(rules?: string): string {
  return rules?.trim()
    ? `\n\nToday's date is ${todayISO()}.\n\nVendor rules (guardrails — override the rules above where they conflict):\n${rules.trim()}`
    : '';
}

// Curated document-level context injected into every chunk's prompt: the fields that help
// the model interpret prices and scope validity (never the noise fields). Only present
// values are rendered; nothing present → '' so the prompt is byte-identical to the
// pre-metadata default. Leads with the LLM summary written at extraction.
export function renderDocumentContext(metadata: DocumentMetadata): string {
  const lines: string[] = [];
  if (metadata.summary?.trim())
    lines.push(`- Overview: ${metadata.summary.trim()}`);
  if (metadata.documentKind?.trim())
    lines.push(`- Kind: ${metadata.documentKind.trim()}`);
  if (metadata.vendorName?.trim())
    lines.push(`- Vendor: ${metadata.vendorName.trim()}`);
  if (metadata.currency?.trim())
    lines.push(`- Currency: ${metadata.currency.trim()}`);
  if (metadata.documentDate?.trim())
    lines.push(`- Document date: ${metadata.documentDate.trim()}`);
  if (metadata.validFrom || metadata.validTo)
    lines.push(
      `- Valid: ${metadata.validFrom ?? '?'} → ${metadata.validTo ?? '?'}`,
    );
  if (metadata.referenceNumbers?.length)
    lines.push(`- References: ${metadata.referenceNumbers.join(', ')}`);

  if (lines.length === 0) return '';
  return `\n\nDocument context (the whole document this chunk belongs to):\n${lines.join('\n')}`;
}
