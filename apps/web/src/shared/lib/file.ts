/** Split a filename into base + extension (including the dot), e.g. "a.pdf" → { base: "a", ext: ".pdf" }. */
export function splitFilename(name: string): { base: string; ext: string } {
  const lastDot = name.lastIndexOf(".")
  if (lastDot === -1) return { base: name, ext: "" }
  return { base: name.slice(0, lastDot), ext: name.slice(lastDot) }
}

/** Human-readable file size, e.g. 8912345 → "8.5 MB". */
export function formatFileSizeForDisplay(bytes: number): string {
  if (bytes === 0) return "0 Bytes"
  const k = 1024
  const sizes = ["Bytes", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${Number.parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`
}

/** Dupe check by name + size + lastModified. */
export function isDuplicate(file: File, existing: File[]): boolean {
  return existing.some(
    (f) =>
      f.name === file.name &&
      f.size === file.size &&
      f.lastModified === file.lastModified
  )
}
