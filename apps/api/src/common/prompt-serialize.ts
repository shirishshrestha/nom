// ponytail: prompt-only serializers (token thrift for LLM payloads) — never parse
// their output back; use JSON for anything that round-trips.

function scalar(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.map(scalar).join(', ');
  if (typeof v === 'object')
    return Object.entries(v as Record<string, unknown>)
      .map(([k, val]) => `${k}=${scalar(val)}`)
      .join(', ');
  // Only string/number/boolean reach here (object/array/nullish handled above) —
  // this is the intended catch-all scalar stringifier.
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  return String(v);
}

/**
 * Braceless table for an array of uniform records — keys appear once as a header
 * row instead of repeating per record. Columns that are null/empty on every row
 * are dropped. Replaces JSON.stringify(array) as an LLM human-message payload.
 */
export function toTable(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '(none)';
  const columns = Object.keys(rows[0]).filter((col) =>
    rows.some((r) => r[col] !== null && r[col] !== undefined && r[col] !== ''),
  );
  const lines = [columns.join(' | ')];
  for (const row of rows)
    lines.push(columns.map((c) => scalar(row[c])).join(' | '));
  return lines.join('\n');
}

/** Braceless indented key: value for a single (optionally nested) object. */
export function toYaml(obj: Record<string, unknown>): string {
  return Object.entries(obj)
    .map(([k, v]) => {
      if (Array.isArray(v))
        return v.length
          ? `${k}:\n${v.map((item) => `  - ${scalar(item)}`).join('\n')}`
          : `${k}: —`;
      if (v !== null && typeof v === 'object') {
        const nested = Object.entries(v as Record<string, unknown>)
          .map(([nk, nv]) => `  ${nk}: ${scalar(nv)}`)
          .join('\n');
        return nested ? `${k}:\n${nested}` : `${k}: —`;
      }
      return `${k}: ${scalar(v)}`;
    })
    .join('\n');
}
