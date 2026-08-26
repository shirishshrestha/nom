import type { DocumentType } from '@nom/shared';

// A document's content satisfies exactly one *attribute set*; the extractor picks
// it and the choice drives validation and the service extraction schema / Neo4j
// Attributes bag. Add a kind = add one ATTRIBUTE_SETS entry.

export type AttrType = 'string' | 'number';

export type AttributeDef = {
  key: string;
  label: string;
  description: string;
  type: AttrType;
  nullable?: boolean;
};

export type AttributeSet = {
  key: string; // plain-string id == the value stored in DocumentEntity.attributeSet
  documentType: DocumentType; // the feature this set belongs to
  label: string; // UI row label
  description: string; // used by the extractor to decide if a document's content fits this set
  promptContext: string; // persona/intro line for the extraction system prompt
  // Optional vertical-specific override for the canonical reuse rule in the extraction /
  // canonical-match prompts. Null → the generic default is used. Keeps domain nuance
  // (e.g. insurance's amendment-chain reuse) in data, not a `set.key ===` code branch.
  reuseGuidance?: string;
  // Free-text naming rules for this vertical's canonical names / tier slugs
  // (shape, examples, what belongs in the name vs description vs tier).
  // Rendered into BOTH the extract and canonical-match prompts. Omitted → the
  // neutral defaults only, so a new vertical works with zero prompt edits.
  namingGuidance?: string;
  // Free-text line-item rules/examples for this vertical (tax vocabulary, formula
  // shapes, sibling-reference examples). Rendered into BOTH the line-item extract
  // and match prompts so the shared rule text stays domain-neutral. Omitted → the
  // neutral defaults only, so a new vertical works with zero prompt edits.
  lineItemGuidance?: string;
  attributes: AttributeDef[];
  amountKeys: string[]; // ordered attribute keys holding the billed/priced total (first non-null wins)
};
