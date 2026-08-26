import { Injectable, Logger } from '@nestjs/common';
import { Neo4jService } from '@nom/neo4j';
import type { GraphNode } from './graph-labels';
import { upsertDocumentCypher } from './cypher/document-graph.cypher';
import { GraphWriteError } from './graph-error';

export interface DocumentGraphNode {
  documentId: string;
  tenantId: string;
  vendorId: string;
  label: GraphNode;
  attributeSet: string | null;
  documentKind: string | null;
  currency: string | null;
  referenceNumbers: string[];
  context: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

// Writes the document mirror node + HAS_DOCUMENT edge. Throws GraphWriteError on
// failure; the caller decides whether that is fatal.
@Injectable()
export class DocumentGraphRepository {
  private readonly logger = new Logger(DocumentGraphRepository.name);

  constructor(private readonly neo4j: Neo4jService) {}

  async upsertDocument(node: DocumentGraphNode): Promise<void> {
    try {
      await this.neo4j.write(upsertDocumentCypher(node.label), {
        vendorId: node.vendorId,
        tenantId: node.tenantId,
        documentId: node.documentId,
        attributeSet: node.attributeSet,
        documentKind: node.documentKind,
        currency: node.currency,
        referenceNumbers: node.referenceNumbers,
        context: node.context,
        effectiveFrom: node.effectiveFrom,
        effectiveTo: node.effectiveTo,
      });
      this.logger.debug(
        `graph upsert ${node.label} doc=${node.documentId} vendor=${node.vendorId}`,
      );
    } catch (e) {
      throw new GraphWriteError(
        `Failed to upsert ${node.label} ${node.documentId} to the graph`,
        e,
      );
    }
  }
}
