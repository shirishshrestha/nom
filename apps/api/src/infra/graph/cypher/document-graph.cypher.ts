import { GRAPH_NODES, GRAPH_RELS, type GraphNode } from '../graph-labels';

// Mirror the join key + reasoning fields of a document onto the graph, linked to
// its vendor. `label` is a validated node label from GRAPH_NODES (never raw input).
export const upsertDocumentCypher = (label: GraphNode): string =>
  `MATCH (v:${GRAPH_NODES.Vendor} {id: $vendorId, tenantId: $tenantId})
   MERGE (d:${label} {id: $documentId, tenantId: $tenantId})
   SET d.attributeSet = $attributeSet,
       d.documentKind = $documentKind,
       d.currency = $currency,
       d.referenceNumbers = $referenceNumbers,
       d.context = $context,
       d.effectiveFrom = $effectiveFrom,
       d.effectiveTo = $effectiveTo
   MERGE (v)-[r:${GRAPH_RELS.HAS_DOCUMENT}]->(d)
   SET r.context = $context`;
