/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import {
  TypeOrmModule,
  getDataSourceToken,
  getRepositoryToken,
} from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import request from 'supertest';
import {
  ContentEntity,
  DocumentEntity,
  FileEntity,
  OrganizationEntity,
  StagedServiceExtractionEntity,
  VendorEntity,
} from '@nom/database';
import { DOCUMENT_STATUSES, STAGED_STATUSES } from '@nom/shared';
import { Neo4jModule, Neo4jService } from '@nom/neo4j';

import { InfraModule } from '../src/infra/infra.module';
import { AttributeSetModule } from '../src/attribute-set/attributes.module';
import { SharedLoadingModule } from '../src/shared-loading/shared-loading.module';
import { FilesModule } from '../src/files/files.module';
import { DocumentsModule } from '../src/documents/documents.module';
import { SourceModule } from '../src/source/source.module';
import { S3Service } from '../src/files/s3.service';
import {
  ADJUDICATOR_EXTRACTOR,
  STRUCTURED_EXTRACTOR,
} from '../src/infra/llm/llm.tokens';
import { FakeStructuredExtractor } from '../src/infra/llm/fake.structured-extractor';
import type { ExtractionRequest } from '../src/infra/llm/structured-extractor.port';

import { DB } from '../src/testing/setup';
import { TEST_ORG_ID, TEST_SESSION } from '../src/testing/test-constants';
import { makeFileDto } from '../src/testing/fixtures';
import { mockNeo4j, mockOrgsRepo, mockS3 } from '../src/testing/mocks';

// Canned LLM output keyed on the operation tag (id@version). The fake casts each
// return to the schema type without validating, so we only fill the read fields.
const fakeStructured = new FakeStructuredExtractor(
  (req: ExtractionRequest<unknown>) => {
    const op = req.options?.operation ?? '';
    if (op.startsWith('document.extract'))
      return {
        metadata: {
          isFinancial: true,
          attributeSet: 'quotation',
          vendorName: 'Test Vendor',
          documentKind: 'rate card',
          currency: 'SGD',
          documentDate: '2024-01-15',
          validFrom: '2024-01-15',
          validTo: null,
          referenceNumbers: ['QT-1'],
        },
        sections: [
          {
            label: 'Storage',
            text: 'Ambient storage S$10 per pallet/month',
            isSummary: false,
          },
        ],
      };
    if (op.startsWith('vendor.match'))
      return { isMatch: true, reason: 'matches' };
    if (op.startsWith('service.extract'))
      return {
        services: [
          {
            canonicalName: 'ambient_storage',
            canonicalDescription: 'Ambient pallet storage',
            title: 'Ambient',
            category: 'storage',
            tier: null,
            tierSlug: null,
            pricingContext: 'per pallet per month',
            foundAt: 'Storage',
            sourceText: 'Ambient storage S$10',
            attributes: {
              price: 10,
              currency: 'SGD',
              unit: 'pallet/month',
              remarks: null,
            },
          },
        ],
      };
    throw new Error(`unexpected STRUCTURED op: ${op}`);
  },
);

// Adjudicator (canonical re-match): echo exactly one assignment per input line id.
// The human payload is a `toTable` pipe table (`id | title | …`), not JSON — read the
// ids from the `id` column.
const fakeAdjudicator = new FakeStructuredExtractor(
  (req: ExtractionRequest<unknown>) => {
    const [header, ...rows] = (req.human as string).split('\n');
    const idCol = header.split(' | ').indexOf('id');
    return {
      assignments: rows.map((r) => ({
        id: r.split(' | ')[idCol].trim(),
        canonicalName: 'ambient_storage',
        canonicalDescription: 'Ambient pallet storage',
        tierSlug: null,
      })),
    };
  },
);

describe('Source pipeline (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let vendorId: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({
          ...DB,
          entities: [
            DocumentEntity,
            ContentEntity,
            StagedServiceExtractionEntity,
            FileEntity,
            VendorEntity,
            OrganizationEntity,
          ],
          synchronize: true,
        }),
        Neo4jModule,
        InfraModule,
        AttributeSetModule,
        SharedLoadingModule,
        FilesModule,
        DocumentsModule,
        SourceModule,
      ],
    })
      .overrideProvider(STRUCTURED_EXTRACTOR)
      .useValue(fakeStructured)
      .overrideProvider(ADJUDICATOR_EXTRACTOR)
      .useValue(fakeAdjudicator)
      .overrideProvider(Neo4jService)
      .useValue(mockNeo4j)
      .overrideProvider(S3Service)
      .useValue(mockS3)
      .overrideProvider(getRepositoryToken(OrganizationEntity))
      .useValue(mockOrgsRepo)
      .compile();

    app = module.createNestApplication();
    app.use((req: any, _res: any, next: () => void) => {
      req.session = TEST_SESSION;
      next();
    });
    app.useGlobalPipes(new ValidationPipe());
    await app.init();

    dataSource = module.get<DataSource>(getDataSourceToken());
    // Let the id be generated â€” a valid v4 UUID (TEST_VENDOR_ID's version nibble
    // fails @IsUUID() on the confirm DTO).
    const vendor = await dataSource
      .getRepository(VendorEntity)
      .save({ name: 'Test Vendor', organizationId: TEST_ORG_ID });
    vendorId = vendor.id;
  });

  afterAll(async () => {
    for (const e of [
      StagedServiceExtractionEntity,
      ContentEntity,
      DocumentEntity,
      FileEntity,
      VendorEntity,
    ])
      await dataSource.getRepository(e).delete({ organizationId: TEST_ORG_ID });
    await app.close();
  });

  it('uploads a file then runs extract â†’ validate â†’ stage â†’ commit', async () => {
    const http = app.getHttpServer();

    // 1. presign â€” a pending file row
    const presign = await request(http)
      .post('/files/presign')
      .send(makeFileDto())
      .expect(201);
    const fileId = presign.body.data.file.id as string;
    expect(presign.body.data.file.status).toBe('pending');
    expect(presign.body.data.uploadUrl).toMatch(/^https:\/\//);

    // 2. confirm â€” file linked to the vendor, status uploaded
    const confirm = await request(http)
      .post(`/files/${fileId}/confirm`)
      .send({ vendorId })
      .expect(201);
    expect(confirm.body.data.status).toBe('uploaded');

    // 3. extract â€” document + content chunks persisted
    const extract = await request(http)
      .post('/files/extract-metadata')
      .send({ fileIds: [fileId] })
      .expect(201);
    const documentId = extract.body.data[0].documentId as string;
    expect(extract.body.data[0].status).toBe(DOCUMENT_STATUSES.EXTRACTED);

    const doc = await dataSource
      .getRepository(DocumentEntity)
      .findOneBy({ id: documentId });
    expect(doc?.status).toBe(DOCUMENT_STATUSES.EXTRACTED);
    const chunkCount = await dataSource
      .getRepository(ContentEntity)
      .countBy({ documentId, organizationId: TEST_ORG_ID });
    expect(chunkCount).toBeGreaterThan(0);

    // 4. validate
    const validate = await request(http)
      .post(`/source/documents/${documentId}/validate`)
      .expect(201);
    expect(validate.body.data.status).toBe(DOCUMENT_STATUSES.VALIDATED);

    // 5. extract-services â€” one staged service, document now staged
    const staged = await request(http)
      .post(`/source/documents/${documentId}/extract-services`)
      .expect(201);
    expect(staged.body.data.services).toHaveLength(1);
    const serviceId = staged.body.data.services[0].id as string;

    const stagedRow = await dataSource
      .getRepository(StagedServiceExtractionEntity)
      .findOne({
        where: { documentId, organizationId: TEST_ORG_ID },
        order: { version: 'DESC' },
      });
    expect(stagedRow?.status).toBe(STAGED_STATUSES.STAGED);
    const docStaged = await dataSource
      .getRepository(DocumentEntity)
      .findOneBy({ id: documentId });
    expect(docStaged?.status).toBe(DOCUMENT_STATUSES.STAGED);

    // 6. uncommitted â€” the doc shows up with its service
    const uncommitted = await request(http)
      .get('/source/uncommitted')
      .query({ vendorId })
      .expect(200);
    const listed = uncommitted.body.data.documents.find(
      (d: any) => d.documentId === documentId,
    );
    expect(listed.services).toHaveLength(1);

    // 7. save-services â€” commit to the (mocked) graph, document committed
    const commit = await request(http)
      .post(`/source/documents/${documentId}/save-services`)
      .send({
        services: [
          {
            id: serviceId,
            attributes: {
              price: 10,
              currency: 'SGD',
              unit: 'pallet/month',
              remarks: null,
            },
          },
        ],
      })
      .expect(201);
    expect(commit.body.data.status).toBe(DOCUMENT_STATUSES.COMMITTED);
    expect(commit.body.data.serviceCount).toBe(1);

    const committedDoc = await dataSource
      .getRepository(DocumentEntity)
      .findOneBy({ id: documentId });
    expect(committedDoc?.status).toBe(DOCUMENT_STATUSES.COMMITTED);
    const committedRow = await dataSource
      .getRepository(StagedServiceExtractionEntity)
      .findOne({
        where: { documentId, organizationId: TEST_ORG_ID },
        order: { version: 'DESC' },
      });
    expect(committedRow?.status).toBe(STAGED_STATUSES.COMMITTED);
  });

  it('extract → mark-ready → commit-all (batch) commits the accepted staged row', async () => {
    const http = app.getHttpServer();
    const stagedRepo = dataSource.getRepository(StagedServiceExtractionEntity);

    // upload → confirm → extract → validate → extract-services (a fresh doc)
    const presign = await request(http)
      .post('/files/presign')
      .send(makeFileDto())
      .expect(201);
    const fileId = presign.body.data.file.id as string;
    await request(http)
      .post(`/files/${fileId}/confirm`)
      .send({ vendorId })
      .expect(201);
    const extract = await request(http)
      .post('/files/extract-metadata')
      .send({ fileIds: [fileId] })
      .expect(201);
    const documentId = extract.body.data[0].documentId as string;
    await request(http)
      .post(`/source/documents/${documentId}/validate`)
      .expect(201);
    await request(http)
      .post(`/source/documents/${documentId}/extract-services`)
      .expect(201);

    // mark-ready (no edits) → the live row flips to ready_to_commit in place, no graph write
    const ready = await request(http)
      .post(`/source/documents/${documentId}/mark-ready`)
      .send({ services: [] })
      .expect(201);
    expect(ready.body.data.reviewStatus).toBe(STAGED_STATUSES.READY);

    const readyRow = await stagedRepo.findOne({
      where: { documentId, organizationId: TEST_ORG_ID },
      order: { version: 'DESC' },
    });
    expect(readyRow?.status).toBe(STAGED_STATUSES.READY);
    // the document itself stays STAGED — review state rides on the staged row
    const docAfterReady = await dataSource
      .getRepository(DocumentEntity)
      .findOneBy({ id: documentId });
    expect(docAfterReady?.status).toBe(DOCUMENT_STATUSES.STAGED);

    // the review feed surfaces the review status so the UI can drive the buttons
    const uncommitted = await request(http)
      .get('/source/uncommitted')
      .query({ vendorId })
      .expect(200);
    const listed = uncommitted.body.data.documents.find(
      (d: any) => d.documentId === documentId,
    );
    expect(listed.reviewStatus).toBe(STAGED_STATUSES.READY);

    // commit-all with the accepted staged-row id → committed to the (mocked) graph
    const commitAll = await request(http)
      .post('/source/commit-all')
      .send({ vendorId, stagedIds: [readyRow!.id] })
      .expect(201);
    expect(commitAll.body.data.failed).toHaveLength(0);
    expect(commitAll.body.data.committed).toHaveLength(1);
    expect(commitAll.body.data.committed[0].documentId).toBe(documentId);

    const committedDoc = await dataSource
      .getRepository(DocumentEntity)
      .findOneBy({ id: documentId });
    expect(committedDoc?.status).toBe(DOCUMENT_STATUSES.COMMITTED);
    const committedRow = await stagedRepo.findOne({
      where: { documentId, organizationId: TEST_ORG_ID },
      order: { version: 'DESC' },
    });
    expect(committedRow?.status).toBe(STAGED_STATUSES.COMMITTED);
  });
});
