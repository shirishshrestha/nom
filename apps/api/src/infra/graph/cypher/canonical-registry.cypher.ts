import { GRAPH_NODES, GRAPH_RELS } from '../graph-labels';

// All canonical-service names already known for a vendor — feeds the extractor so
// it reuses names instead of minting duplicates.
export const CANONICAL_REGISTRY_CYPHER = `MATCH (c:${GRAPH_NODES.CanonicalService} {vendorId:$vendorId, tenantId:$tenantId})
   RETURN c.canonicalName AS canonicalName, c.description AS description`;

// Every current service per canonical for a vendor — feeds the extractor + reconciler so
// the same band reuses one slug across documents (the amendment key), and so flat (null-slug)
// services surface their pricing attributes for rate-aware matching. tierSlug is null for flat.
export const TIER_REGISTRY_CYPHER = `MATCH (c:${GRAPH_NODES.CanonicalService} {vendorId:$vendorId, tenantId:$tenantId})<-[:${GRAPH_RELS.IS_A}]-(s:${GRAPH_NODES.Service} {current:true})
   OPTIONAL MATCH (s)-[:${GRAPH_RELS.HAS_ATTRIBUTES}]->(a:${GRAPH_NODES.Attributes})
   RETURN c.canonicalName AS canonicalName, s.tierSlug AS tierSlug, s.tier AS label, s.pricingContext AS pricingContext, properties(a) AS attributes`;

// Lucene full-text candidate search over a vendor's canonical registry — used only
// as a size-gated pre-filter (see callers) so a huge registry isn't shipped whole to
// the LLM. Ranked by relevance to $query; $topK caps the result.
export const CANONICAL_FULLTEXT_SEARCH_CYPHER = `
CALL db.index.fulltext.queryNodes('canonical_fulltext_v2', $query) YIELD node, score
WHERE node.vendorId = $vendorId AND node.tenantId = $tenantId
RETURN node.canonicalName AS canonicalName
ORDER BY score DESC
LIMIT $topK`;
