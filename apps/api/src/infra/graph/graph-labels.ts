import type { DocumentType } from '@nom/shared';

/**
 * Single source of truth for every Neo4j node label and relationship type used
 * across the documents + source pipelines. Inline Cypher and the constraint
 * bootstrap should interpolate these constants rather than repeat bare strings,
 * so a label can never drift between writer, reader, and schema.
 */
export const GRAPH_NODES = {
  Vendor: 'Vendor',
  SourceDocument: 'SourceDocument',
  TransactionDocument: 'TransactionDocument',
  Service: 'Service',
  CanonicalService: 'CanonicalService',
  LineItem: 'LineItem',
  Attributes: 'Attributes',
  Rule: 'Rule',
} as const;

export type GraphNode = keyof typeof GRAPH_NODES;

export const GRAPH_RELS = {
  HAS_DOCUMENT: 'HAS_DOCUMENT',
  IS_A: 'IS_A',
  DEFINES: 'DEFINES',
  OFFERS: 'OFFERS',
  HAS_ATTRIBUTES: 'HAS_ATTRIBUTES',
  AMENDS: 'AMENDS', // newer Service -> the prior current one it supersedes (audit chain)
  PRICED_FROM: 'PRICED_FROM', // Service -> CanonicalService its price is derived from (carries {relation, referencedTierSlug})
  HAS_LINE_ITEM: 'HAS_LINE_ITEM', // TransactionDocument -> the LineItem it bills
  BILLED_AS: 'BILLED_AS', // LineItem -> CanonicalService it bills (service match)
  REFERENCES: 'REFERENCES', // LineItem -> sibling LineItem its amount is computed from
  RULED_BY: 'RULED_BY', // Document -> Rule applied to it during a phase (tracking edge; carries {phase, at})
} as const;

export type GraphRel = keyof typeof GRAPH_RELS;

// The only per-documentType graph variation: which node label a document maps to.
// Partial — types without an entry are not mirrored to the graph.
export const DOCUMENT_GRAPH_LABELS: Partial<Record<DocumentType, GraphNode>> = {
  source: GRAPH_NODES.SourceDocument,
  transaction: GRAPH_NODES.TransactionDocument,
};
