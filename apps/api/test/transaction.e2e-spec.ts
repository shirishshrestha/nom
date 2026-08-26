/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import {
  TypeOrmModule,
  getDataSourceToken,
  getRepositoryToken,
} from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import type { Repository } from 'typeorm';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { Neo4jService } from '@nom/neo4j';
import {
  ContentEntity,
  DocumentEntity,
  FileEntity,
  VendorEntity,
  PipelineLogEntity,
  PipelineReasoningEntity,
} from '@nom/database';
import {
  DOCUMENT_STATUSES,
  DOCUMENT_TYPES,
  OBSERVABILITY_ENTITY_TYPES,
} from '@nom/shared';
import type { DocumentStatus } from '@nom/shared';
import { TransactionController } from '../src/transaction/transaction.controller';
import { TransactionService } from '../src/transaction/transaction.service';
import { LineItemExtractor } from '../src/transaction/extraction/line-item-extractor';
import { TransactionExtractFlow } from '../src/transaction/extraction/extract-line-items.flow';
import { LineItemMatcher } from '../src/transaction/matching/line-item-matcher';
import { SymbolResolver } from '../src/transaction/matching/symbol-resolver';
import { SiblingSymbolResolver } from '../src/transaction/matching/sibling-symbol-resolver';
import { AmountReconciler } from '../src/transaction/matching/amount-reconciler';
import { TransactionMatchFlow } from '../src/transaction/matching/match-line-items.flow';
import { MATCH_QUEUE } from '../src/transaction/matching/match.processor';
import { PipelineLogRepository } from '../src/transaction/persistence/pipeline-log.repository';
import { PipelineReasoningRepository } from '../src/transaction/persistence/pipeline-reasoning.repository';
import { DocumentContextLoader } from '../src/shared-loading/document-context.loader';
import { LineItemGraphRepository } from '../src/infra/graph/line-item-graph.repository';
import { CanonicalRegistryRepository } from '../src/infra/graph/canonical-registry.repository';
import { ServiceGraphRepository } from '../src/infra/graph/service-graph.repository';
import { AttributeSetRegistry } from '../src/attribute-set';
import {
  STRUCTURED_EXTRACTOR,
  ADJUDICATOR_EXTRACTOR,
} from '../src/infra/llm/llm.tokens';
import { FakeStructuredExtractor } from '../src/infra/llm/fake.structured-extractor';
import { DocumentsService } from '../src/documents/documents.service';
import { RulesService } from '../src/rules/rules.service';
import { DB } from '../src/testing/setup';
import { TEST_SESSION, TEST_ORG_ID } from '../src/testing/test-constants';

// The transaction pipeline reads/writes Neo4j and calls the LLM, so those two ports
// are faked; Postgres is real — the seeded DocumentEntity row drives the status gate,
// and we assert the row's status flips after extraction.

// Neo4j stub: reads return nothing; writes echo back counts matching the payload so
// LineItemGraphRepository's integrity assertions pass.
const neo4jStub = {
  read: () => Promise.resolve([]),
  write: (_cypher: string, params?: any) =>
    Promise.resolve([
      {
        get: (k: string) =>
          ({
            lineItemCount: (params?.rows ?? []).length,
            updatedCount: (params?.rows ?? []).length,
            billedCount: (params?.serviceMatches ?? []).length,
            refCount: (params?.references ?? []).length,
          })[k] ?? null,
      },
    ]),
} as unknown as Neo4jService;

// One extracted line per invoice chunk.
const extractStub = new FakeStructuredExtractor(() => ({
  lineItems: [
    {
      description: 'Truck 1x40 FCL',
      foundAt: 'line 1',
      sourceText: '1 Truck 1x40 FCL 220.00',
      attributes: { quantity: 1, amount: 220, currency: 'SGD' },
      initialKind: 'unmatched',
      initialCanonical: null,
      initialTierSlug: null,
      initialRefSummary: null,
      taxable: true,
      taxPercentage: 9,
      formula: 'rate * quantity',
      symbols: [{ name: 'quantity', value: 1 }],
    },
  ],
}));
const matchStub = new FakeStructuredExtractor(() => ({ matches: [] }));

const docsStub = {
  listDocuments: () => Promise.resolve([{ documentId: 'doc-x' }]),
  validate: () => Promise.resolve({ documentId: 'doc-x' }),
};

describe('Transaction (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let fileId: string;
  let prevMatchAsync: string | undefined;

  beforeAll(async () => {
    prevMatchAsync = process.env.TRANSACTION_MATCH_ASYNC;

    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({
          ...DB,
          entities: [
            DocumentEntity,
            ContentEntity,
            FileEntity,
            VendorEntity,
            PipelineLogEntity,
            PipelineReasoningEntity,
          ],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([
          DocumentEntity,
          ContentEntity,
          FileEntity,
          PipelineLogEntity,
          PipelineReasoningEntity,
        ]),
      ],
      controllers: [TransactionController],
      providers: [
        TransactionService,
        LineItemExtractor,
        TransactionExtractFlow,
        LineItemMatcher,
        SymbolResolver,
        SiblingSymbolResolver,
        AmountReconciler,
        TransactionMatchFlow,
        DocumentContextLoader,
        LineItemGraphRepository,
        CanonicalRegistryRepository,
        ServiceGraphRepository,
        AttributeSetRegistry,
        {
          provide: PipelineLogRepository,
          useFactory: (repo: Repository<PipelineLogEntity>) =>
            new PipelineLogRepository(
              repo,
              OBSERVABILITY_ENTITY_TYPES.LINE_ITEM,
            ),
          inject: [getRepositoryToken(PipelineLogEntity)],
        },
        {
          provide: PipelineReasoningRepository,
          useFactory: (repo: Repository<PipelineReasoningEntity>) =>
            new PipelineReasoningRepository(
              repo,
              OBSERVABILITY_ENTITY_TYPES.LINE_ITEM,
            ),
          inject: [getRepositoryToken(PipelineReasoningEntity)],
        },
        { provide: Neo4jService, useValue: neo4jStub },
        { provide: STRUCTURED_EXTRACTOR, useValue: extractStub },
        { provide: ADJUDICATOR_EXTRACTOR, useValue: matchStub },
        { provide: DocumentsService, useValue: docsStub },
        // Extract/match flows inject RulesService; stub it (rulesFor → undefined, as the
        // flow unit specs do) so the pipeline runs without rule selection.
        {
          provide: RulesService,
          useValue: {
            rulesFor: () => Promise.resolve(undefined),
            markRulesApplied: () => Promise.resolve(),
          },
        },
        // TransactionService injects the BullMQ match queue; stub add() so DI resolves
        // without a real Redis connection (small docs match synchronously anyway).
        {
          provide: getQueueToken(MATCH_QUEUE),
          useValue: { add: () => Promise.resolve() },
        },
      ],
    }).compile();

    app = module.createNestApplication();
    app.use((req: any, _res: any, next: () => void) => {
      req.session = TEST_SESSION;
      next();
    });
    app.useGlobalPipes(new ValidationPipe());
    await app.init();
    // These specs assert the synchronous match contract (inline counts / 400 guard).
    // .env ships TRANSACTION_MATCH_ASYNC=true (its worker path needs a real Redis to
    // observe) and ConfigModule.forRoot re-loads it during compile — so pin the sync
    // path here, after init (restored in afterAll). Read per-request, so this suffices.
    delete process.env.TRANSACTION_MATCH_ASYNC;
    dataSource = module.get<DataSource>(getDataSourceToken());

    const file = await dataSource.getRepository(FileEntity).save({
      name: 'invoice.pdf',
      storageKey: `${TEST_ORG_ID}/invoice.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      documentType: DOCUMENT_TYPES.TRANSACTION,
      organizationId: TEST_ORG_ID,
    });
    fileId = file.id;
  });

  afterAll(async () => {
    await dataSource
      .getRepository(FileEntity)
      .delete({ organizationId: TEST_ORG_ID });
    await app.close();
    if (prevMatchAsync === undefined)
      delete process.env.TRANSACTION_MATCH_ASYNC;
    else process.env.TRANSACTION_MATCH_ASYNC = prevMatchAsync;
  });

  afterEach(async () => {
    await dataSource
      .getRepository(ContentEntity)
      .delete({ organizationId: TEST_ORG_ID });
    await dataSource
      .getRepository(DocumentEntity)
      .delete({ organizationId: TEST_ORG_ID });
  });

  // Seed a transaction document (+ one content chunk) and return its id.
  async function seedDoc(status: DocumentStatus): Promise<string> {
    const doc = await dataSource.getRepository(DocumentEntity).save({
      fileId,
      documentType: DOCUMENT_TYPES.TRANSACTION,
      attributeSet: 'invoice',
      status,
      organizationId: TEST_ORG_ID,
    });
    await dataSource.getRepository(ContentEntity).save({
      documentId: doc.id,
      documentType: DOCUMENT_TYPES.TRANSACTION,
      label: 'Invoice A',
      text: 'body',
      position: 0,
      organizationId: TEST_ORG_ID,
    });
    return doc.id;
  }

  it('POST extract-line-items → 201, commits the doc and returns line items', async () => {
    const id = await seedDoc(DOCUMENT_STATUSES.VALIDATED);
    const res = await request(app.getHttpServer())
      .post(`/transaction/documents/${id}/extract-line-items`)
      .expect(201);

    expect(res.body.data.status).toBe(DOCUMENT_STATUSES.COMMITTED);
    expect(res.body.data.lineItems).toHaveLength(1);

    const row = await dataSource
      .getRepository(DocumentEntity)
      .findOneBy({ id });
    expect(row?.status).toBe(DOCUMENT_STATUSES.COMMITTED);
  });

  it('POST match-line-items on a committed doc → 201 with counts', async () => {
    const id = await seedDoc(DOCUMENT_STATUSES.COMMITTED);
    const res = await request(app.getHttpServer())
      .post(`/transaction/documents/${id}/match-line-items`)
      .expect(201);

    expect(res.body.data).toMatchObject({
      documentId: id,
      serviceMatchCount: 0,
      siblingRefCount: 0,
      unmatchedCount: 0,
    });
  });

  it('POST match-line-items before extraction → 400', async () => {
    const id = await seedDoc(DOCUMENT_STATUSES.VALIDATED);
    await request(app.getHttpServer())
      .post(`/transaction/documents/${id}/match-line-items`)
      .expect(400);
  });

  it('POST match-line-items with a non-UUID id → 400', () =>
    request(app.getHttpServer())
      .post('/transaction/documents/not-a-uuid/match-line-items')
      .expect(400));

  it('GET line-items with a non-UUID id → 400', () =>
    request(app.getHttpServer())
      .get('/transaction/documents/not-a-uuid/line-items')
      .expect(400));

  it('GET line-items → 200 envelope', async () => {
    const id = await seedDoc(DOCUMENT_STATUSES.COMMITTED);
    const res = await request(app.getHttpServer())
      .get(`/transaction/documents/${id}/line-items`)
      .expect(200);
    expect(res.body.data).toEqual({ documentId: id, lineItems: [] });
  });

  it('GET /transaction/documents → 200 list', async () => {
    const res = await request(app.getHttpServer())
      .get('/transaction/documents')
      .expect(200);
    expect(res.body.data).toEqual([{ documentId: 'doc-x' }]);
  });
});
