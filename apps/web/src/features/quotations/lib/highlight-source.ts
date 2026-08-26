/**
 * Locate `needle` inside `text` while ignoring whitespace differences: the
 * content chunk keeps the PDF's line breaks and stray spaces, whereas a
 * service's `sourceText` is whitespace-normalized. Builds a case-insensitive
 * regex from `needle` with each whitespace run loosened to `\s+`, so the
 * match's `[start, end)` range is a span of the ORIGINAL text (line breaks
 * preserved). Returns null when the phrase isn't present.
 */
export function findSourceRange(
  text: string,
  needle: string
): { start: number; end: number } | null {
  const words = needle.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return null

  const pattern = words
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+")
  const match = new RegExp(pattern, "i").exec(text)
  return match
    ? { start: match.index, end: match.index + match[0].length }
    : null
}
