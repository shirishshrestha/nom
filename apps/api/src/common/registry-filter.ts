import { normalizeCanonical } from './canonical';
import type {
  CanonicalRegistryEntry,
  CanonicalRegistryRepository,
  TierRegistryEntry,
} from '../infra/graph/canonical-registry.repository';

// ponytail: a fixed threshold/top-K, not configurable — revisit if a vendor's
// registry routinely sits near this cutoff and the fixed values prove wrong for them.
// Threshold is on TOTAL rendered entries (canonicals + tier rows), not canonicals alone.
export const REGISTRY_FILTER_THRESHOLD = 60;
const REGISTRY_FILTER_TOP_K = 30;

export interface FilteredRegistry {
  registry: CanonicalRegistryEntry[];
  tiers: TierRegistryEntry[];
}

/**
 * Size-gated candidate pre-filter for the registry rendered into a match/reconcile
 * prompt. Below REGISTRY_FILTER_THRESHOLD TOTAL rendered entries (canonicals + tier
 * rows — the tier rows, each carrying a pricingContext string, are the dominant token
 * cost, so the gate counts both), the whole registry ships unfiltered — cheap and
 * safest. Above it, narrow to a Lucene full-text top-K over `queryText` UNION every
 * item's current canonical guess, so a real match under different wording is never
 * silently dropped. Never a vector/embedding search — Lucene full-text is the
 * sanctioned similarity mechanism in this codebase.
 */
export async function filterRegistryForBatch(
  search: CanonicalRegistryRepository,
  tenantId: string,
  vendorId: string,
  registry: CanonicalRegistryEntry[],
  tiers: TierRegistryEntry[],
  queryText: string,
  currentGuesses: Array<string | null>,
): Promise<FilteredRegistry> {
  if (registry.length + tiers.length <= REGISTRY_FILTER_THRESHOLD)
    return { registry, tiers };

  const candidates = await search.searchCanonicals(
    tenantId,
    vendorId,
    queryText,
    REGISTRY_FILTER_TOP_K,
  );
  const keep = new Set(candidates);
  for (const guess of currentGuesses) {
    if (guess) keep.add(normalizeCanonical(guess));
  }
  return {
    registry: registry.filter((c) => keep.has(c.canonicalName)),
    tiers: tiers.filter((t) => keep.has(t.canonicalName)),
  };
}
