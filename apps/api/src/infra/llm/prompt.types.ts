// A versioned, named prompt. Bump `version` on any wording change so the value
// can be persisted into provenance and prior extractions stay comparable.
export interface PromptTemplate<Ctx> {
  /** Stable id, e.g. 'document.extract'. */
  id: string;
  /** Bump on any change to render(). */
  version: string;
  render(ctx: Ctx): string;
}

// Convenience tag for the extractor `operation` field: 'document.extract@v1'.
export function promptTag(t: PromptTemplate<unknown>): string {
  return `${t.id}@${t.version}`;
}
