/**
 * Canonical grouping key: lowercase, trim, collapse non-alphanumeric runs to '_'.
 * "Customs Clearance" / "customs-clearance" / "customs  clearance" -> "customs_clearance".
 * The canonical name is BOTH the dedup key and the graph MERGE key, so normalizing
 * it at the source makes mechanical variants collapse everywhere downstream.
 */
export const normalizeCanonical = (name: string): string =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
