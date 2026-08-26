/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import {
  TypeOrmModule,
  getDataSourceToken,
  getRepositoryToken,
} from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { readFileSync } from 'fs';
import request from 'supertest';
import { FileEntity, OrganizationEntity, VendorEntity } from '@nom/database';
import { DOCUMENT_TYPES, FILE_CATEGORIES } from '@nom/shared';
import { FilesController } from '../src/files/files.controller';
import { FilesService } from '../src/files/files.service';
import { S3Service } from '../src/files/s3.service';
import { DocumentsService } from '../src/documents/documents.service';
import { DB } from '../src/testing/setup';
import {
  TEST_SESSION,
  MOCK_ORG,
  TEST_ORG_ID,
} from '../src/testing/test-constants';
import { FIXTURE_FILE } from '../src/testing/fixtures';

const dto = {
  name: 'sample.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 1024,
  documentType: DOCUMENT_TYPES.SOURCE,
  category: FILE_CATEGORIES.DOCUMENT,
};

const mockOrg = MOCK_ORG;

describe('Files (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let vendor: VendorEntity;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({
          ...DB,
          entities: [FileEntity, VendorEntity],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([FileEntity, VendorEntity]),
      ],
      controllers: [FilesController],
      providers: [
        FilesService,
        S3Service,
        {
          provide: getRepositoryToken(OrganizationEntity),
          useValue: { findOneBy: () => Promise.resolve(mockOrg) },
        },
        // FilesController injects DocumentsService (extract endpoint); the presign/upload
        // paths under test don't call it, so a bare stub satisfies DI.
        {
          provide: DocumentsService,
          useValue: { extractMetadata: () => Promise.resolve([]) },
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
    dataSource = module.get<DataSource>(getDataSourceToken());
    vendor = await dataSource
      .getRepository(VendorEntity)
      .save({ name: 'Test Vendor', organizationId: TEST_ORG_ID });
  });

  afterAll(async () => {
    await dataSource
      .getRepository(VendorEntity)
      .delete({ organizationId: TEST_ORG_ID });
    await app.close();
  });

  afterEach(() =>
    dataSource
      .getRepository(FileEntity)
      .delete({ organizationId: MOCK_ORG.id }),
  );

  async function presign(overrides = {}) {
    const res = await request(app.getHttpServer())
      .post('/files/presign')
      .send({ ...dto, ...overrides });
    return res.body.data as { file: { id: string }; uploadUrl: string };
  }

  it('POST /files/presign → 201 pending file + real uploadUrl', async () => {
    const res = await request(app.getHttpServer())
      .post('/files/presign')
      .send(dto)
      .expect(201);
    expect(res.body.data.file.status).toBe('pending');
    expect(res.body.data.file.organizationId).toBe(TEST_ORG_ID);
    expect(res.body.data.uploadUrl).toMatch(/^https:\/\//);
  });

  it('upload lifecycle: presign → PUT to S3 → confirm → download url', async () => {
    const { file, uploadUrl } = await presign();

    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      body: readFileSync(FIXTURE_FILE),
      headers: { 'Content-Type': 'application/pdf' },
    });
    expect(uploadRes.ok).toBe(true);

    const confirmRes = await request(app.getHttpServer())
      .post(`/files/${file.id}/confirm`)
      .send({ vendorId: vendor.id })
      .expect(201);
    expect(confirmRes.body.data.status).toBe('uploaded');
    expect(confirmRes.body.data.vendorId).toBe(vendor.id);

    const urlRes = await request(app.getHttpServer())
      .get(`/files/${file.id}/url`)
      .expect(200);
    expect(urlRes.body.data.url).toMatch(/^https:\/\//);
  });

  it('GET /files → 200 list', async () => {
    await presign();
    await presign({ name: 'other.pdf' });
    const res = await request(app.getHttpServer()).get('/files').expect(200);
    expect(res.body.data).toHaveLength(2);
  });

  it('GET /files/:id → 200 single file', async () => {
    const { file } = await presign();
    const res = await request(app.getHttpServer())
      .get(`/files/${file.id}`)
      .expect(200);
    expect(res.body.data.id).toBe(file.id);
  });

  it('PATCH /files/:id → 200 updates name', async () => {
    const { file } = await presign();
    await request(app.getHttpServer())
      .patch(`/files/${file.id}`)
      .send({ name: 'renamed.pdf' })
      .expect(200);
    const res = await request(app.getHttpServer()).get(`/files/${file.id}`);
    expect(res.body.data.name).toBe('renamed.pdf');
  });

  it('DELETE /files/:id → 204 soft deletes, file no longer findable', async () => {
    const { file } = await presign();
    await request(app.getHttpServer()).delete(`/files/${file.id}`).expect(204);
    await request(app.getHttpServer()).get(`/files/${file.id}`).expect(404);
  });
});
