/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { jest } from '@jest/globals';
import { DocumentGraphRepository } from './document-graph.repository';
import { GraphWriteError } from './graph-error';
import { GRAPH_NODES } from './graph-labels';
import type { Neo4jService } from '@nom/neo4j';

const node = {
  documentId: 'doc-1',
  tenantId: 'org-1',
  vendorId: 'vendor-1',
  label: GRAPH_NODES.SourceDocument,
  attributeSet: 'quotation',
  documentKind: 'freight quotation',
  currency: 'SGD',
  referenceNumbers: ['Q-1'],
  context: 'freight quotation from Northstar',
  effectiveFrom: null,
  effectiveTo: null,
};

describe('DocumentGraphRepository', () => {
  it('writes the document mirror with the resolved label', async () => {
    const write = jest.fn<(c: string, p: any) => Promise<unknown[]>>(() =>
      Promise.resolve([]),
    );
    const repo = new DocumentGraphRepository({
      write,
    } as unknown as Neo4jService);

    await repo.upsertDocument(node);
    const [cypher, params] = write.mock.calls[0];
    expect(cypher).toContain(`:${GRAPH_NODES.SourceDocument}`);
    expect(params.documentId).toBe('doc-1');
    expect(params.vendorId).toBe('vendor-1');
  });

  it('wraps a driver failure in GraphWriteError', async () => {
    const write = jest.fn(() =>
      Promise.reject(new Error('connection refused')),
    );
    const repo = new DocumentGraphRepository({
      write,
    } as unknown as Neo4jService);

    await expect(repo.upsertDocument(node)).rejects.toBeInstanceOf(
      GraphWriteError,
    );
  });
});
