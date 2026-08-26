import type { Record as Neo4jRecord } from 'neo4j-driver';
import { GraphReadError } from './graph-error';

// neo4j-driver returns integers as a wrapped Integer with .toNumber(). These
// helpers centralise the unwrap so no business code touches driver internals.

// Non-nullable accessor: fail fast rather than let a null masquerade as a string.
export function getString(rec: Neo4jRecord, key: string): string {
  const v = rec.get(key) as string | null | undefined;
  if (v == null)
    throw new GraphReadError(`Expected non-null string for "${key}"`);
  return v;
}

export function getNullableString(
  rec: Neo4jRecord,
  key: string,
): string | null {
  return (rec.get(key) as string | null) ?? null;
}

export function getNumber(rec: Neo4jRecord, key: string): number {
  const value = rec.get(key) as { toNumber?: () => number } | number | null;
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  return typeof value.toNumber === 'function'
    ? value.toNumber()
    : Number(value);
}

// Unwrap a node-property map (e.g. `properties(a)`) into a plain attribute bag,
// converting any wrapped Integer values to numbers. Works on a raw map whether it
// came from a top-level record field or from inside a collected/nested projection.
export function unwrapAttributeBag(
  raw: Record<string, unknown> | null | undefined,
): Record<string, string | number | null> {
  if (!raw) return {};
  const out: Record<string, string | number | null> = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k] =
      v != null &&
      typeof v === 'object' &&
      typeof (v as { toNumber?: unknown }).toNumber === 'function'
        ? (v as { toNumber: () => number }).toNumber()
        : (v as string | number | null);
  }
  return out;
}

export function getAttributes(
  rec: Neo4jRecord,
  key: string,
): Record<string, string | number | null> {
  return unwrapAttributeBag(rec.get(key) as Record<string, unknown> | null);
}
