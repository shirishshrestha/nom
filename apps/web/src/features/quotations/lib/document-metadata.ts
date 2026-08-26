/** extract-metadata's `metadata` is typed `unknown`; read just the attributeSet tag. */
export function extractedAttributeSet(meta: unknown): string | null {
  if (meta && typeof meta === "object" && "attributeSet" in meta) {
    const value = (meta as { attributeSet?: unknown }).attributeSet
    return typeof value === "string" ? value : null
  }
  return null
}

/** extract-metadata's `metadata` is typed `unknown`; read the documentKind tag. */
export function extractedDocumentKind(meta: unknown): string | null {
  if (meta && typeof meta === "object" && "documentKind" in meta) {
    const value = (meta as { documentKind?: unknown }).documentKind
    return typeof value === "string" ? value : null
  }
  return null
}

/** validate's `metadata` is typed `unknown`; read the isFinancial flag. */
export function extractedIsFinancial(meta: unknown): boolean | null {
  if (meta && typeof meta === "object" && "isFinancial" in meta) {
    const value = (meta as { isFinancial?: unknown }).isFinancial
    return typeof value === "boolean" ? value : null
  }
  return null
}
