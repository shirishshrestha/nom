import { Injectable, Logger } from '@nestjs/common';
import { Neo4jService, int } from '@nom/neo4j';
import {
  CANONICAL_FULLTEXT_SEARCH_CYPHER,
  CANONICAL_REGISTRY_CYPHER,
  TIER_REGISTRY_CYPHER,
} from './cypher/canonical-registry.cypher';
import { getString, getNullableString, getAttributes } from './graph-record';
import { sanitizeLuceneQuery } from './lucene';

export interface CanonicalRegistryEntry {
  canonicalName: string;
  description: string | null;
}

// One current service of a vendor's canonical — feeds slug reuse so the same band converges
// on one slug across documents. tierSlug is null for a flat (single-band) service; its
// pricing attributes surface the contracted price/unit for rate-aware matching.
export interface TierRegistryEntry {
  canonicalName: string;
  tierSlug: string | null;
  label: string | null; // the human tier label last seen for this slug
  pricingContext: string | null; // basis/conditions/qualifiers — the disambiguating text a bare canonical name/description can lack
  attributes: Record<string, string | number | null> | null; // the priced bag (price/unit/currency); null when the service has none
}

// Reads the canonical-service registry for a vendor. Returns [] when the vendor
// is unknown (no graph round-trip).
@Injectable()
export class CanonicalRegistryRepository {
  private readonly logger = new Logger(CanonicalRegistryRepository.name);

  constructor(private readonly neo4j: Neo4jService) {}

  async findForVendor(
    tenantId: string,
    vendorId: string | undefined,
  ): Promise<CanonicalRegistryEntry[]> {
    if (!vendorId) return [];
    const records = await this.neo4j.read(CANONICAL_REGISTRY_CYPHER, {
      vendorId,
      tenantId,
    });
    this.logger.debug(
      `canonical registry vendor=${vendorId} entries=${records.length}`,
    );
    return records.map((r) => ({
      canonicalName: getString(r, 'canonicalName'),
      description: getNullableString(r, 'description'),
    }));
  }

  // Existing tier slugs per canonical for a vendor. Returns [] for an unknown
  // vendor (no graph round-trip).
  async tiersForVendor(
    tenantId: string,
    vendorId: string | undefined,
  ): Promise<TierRegistryEntry[]> {
    if (!vendorId) return [];
    const records = await this.neo4j.read(TIER_REGISTRY_CYPHER, {
      vendorId,
      tenantId,
    });
    return records.map((r) => {
      const attributes = getAttributes(r, 'attributes');
      return {
        canonicalName: getString(r, 'canonicalName'),
        tierSlug: getNullableString(r, 'tierSlug'),
        label: getNullableString(r, 'label'),
        pricingContext: getNullableString(r, 'pricingContext'),
        attributes: Object.keys(attributes).length ? attributes : null,
      };
    });
  }

  // Lucene candidate search — ONLY meant as a size-gated pre-filter (see callers) so
  // a huge registry isn't shipped whole to the LLM. Returns [] when the sanitized
  // query has nothing left to search on (never touches the graph for an empty query).
  async searchCanonicals(
    tenantId: string,
    vendorId: string,
    queryText: string,
    topK: number,
  ): Promise<string[]> {
    const query = sanitizeLuceneQuery(queryText);
    if (!query) return [];
    const records = await this.neo4j.read(CANONICAL_FULLTEXT_SEARCH_CYPHER, {
      vendorId,
      tenantId,
      query,
      topK: int(topK),
    });
    return records.map((r) => getString(r, 'canonicalName'));
  }
}
