import { GRAPH_NODES, GRAPH_RELS, type GraphNode } from '../graph-labels';

// A vendor's rules, newest-first. Ownership is by indexed props (the CanonicalService
// pattern), not an edge.
export const LIST_RULES_CYPHER = `MATCH (r:${GRAPH_NODES.Rule} {vendorId:$vendorId, tenantId:$tenantId})
   RETURN r.id AS id, r.title AS title, r.category AS category, r.content AS content,
          r.createdAt AS createdAt, r.updatedAt AS updatedAt
   ORDER BY r.createdAt DESC`;

// UI search box — Lucene relevance over a vendor's rules (title + content), any category.
export const SEARCH_RULES_CYPHER = `CALL db.index.fulltext.queryNodes('rule_fulltext', $query) YIELD node, score
   WHERE node.vendorId = $vendorId AND node.tenantId = $tenantId
   RETURN node.id AS id, node.title AS title, node.category AS category, node.content AS content,
          node.createdAt AS createdAt, node.updatedAt AS updatedAt
   ORDER BY score DESC
   LIMIT $topK`;

export const CREATE_RULE_CYPHER = `CREATE (r:${GRAPH_NODES.Rule} {
     id:$id, tenantId:$tenantId, vendorId:$vendorId,
     title:$title, category:$category, content:$content,
     createdAt:$now, updatedAt:$now
   })
   RETURN r.id AS id, r.title AS title, r.category AS category, r.content AS content,
          r.createdAt AS createdAt, r.updatedAt AS updatedAt`;

// PATCH semantics — coalesce leaves an absent field ($x = null) unchanged.
export const UPDATE_RULE_CYPHER = `MATCH (r:${GRAPH_NODES.Rule} {id:$id, vendorId:$vendorId, tenantId:$tenantId})
   SET r.title = coalesce($title, r.title),
       r.category = coalesce($category, r.category),
       r.content = coalesce($content, r.content),
       r.updatedAt = $now
   RETURN r.id AS id, r.title AS title, r.category AS category, r.content AS content,
          r.createdAt AS createdAt, r.updatedAt AS updatedAt`;

export const DELETE_RULE_CYPHER = `MATCH (r:${GRAPH_NODES.Rule} {id:$id, vendorId:$vendorId, tenantId:$tenantId})
   WITH r, r.id AS id
   DETACH DELETE r
   RETURN id`;

// All of a vendor's rules for one phase — the runtime selection key. Oldest-first so the
// "first N as pinned core" cut in rulesFor is deterministic; r.id breaks createdAt ties
// (same-millisecond creation on bulk import/seed) so the cut can't shift between calls.
export const RULES_FOR_CATEGORY_CYPHER = `MATCH (r:${GRAPH_NODES.Rule} {vendorId:$vendorId, tenantId:$tenantId, category:$category})
   RETURN r.id AS id, r.title AS title, r.content AS content
   ORDER BY r.createdAt, r.id`;

// Runtime pre-filter — Lucene relevance over a vendor's rules for one phase, capped at
// $topK. Mirrors CANONICAL_FULLTEXT_SEARCH_CYPHER.
export const RULES_FOR_CATEGORY_SEARCH_CYPHER = `CALL db.index.fulltext.queryNodes('rule_fulltext', $query) YIELD node, score
   WHERE node.vendorId = $vendorId AND node.tenantId = $tenantId AND node.category = $category
   RETURN node.id AS id, node.title AS title, node.content AS content
   ORDER BY score DESC
   LIMIT $topK`;

// Record that a set of rules was applied to a document during a phase. MERGE keeps it
// idempotent per (document, rule, phase) — a rerun refreshes `at` without duplicating.
// `label` is a validated GRAPH_NODES label (never raw input).
export const markRulesAppliedCypher = (label: GraphNode): string =>
  `MATCH (r:${GRAPH_NODES.Rule} {tenantId:$tenantId}) WHERE r.id IN $ruleIds
   MERGE (d:${label} {id:$documentId, tenantId:$tenantId})
   MERGE (d)-[rel:${GRAPH_RELS.RULED_BY} {phase:$phase}]->(r)
   SET rel.at = $at
   RETURN count(rel) AS marked`;

// The rules applied to a document, per phase — for a later audit UI. Label-agnostic
// (rule/document ids are unique), so no documentType is needed to read it back.
export const APPLIED_RULES_CYPHER = `MATCH (d {id:$documentId, tenantId:$tenantId})-[rel:${GRAPH_RELS.RULED_BY}]->(r:${GRAPH_NODES.Rule})
   RETURN r.id AS id, r.title AS title, r.category AS category, r.content AS content,
          rel.phase AS phase, rel.at AS at
   ORDER BY rel.at DESC`;
