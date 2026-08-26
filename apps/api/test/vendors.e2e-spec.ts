/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule, getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { FileEntity, VendorEntity } from '@nom/database';
import { Neo4jService } from '@nom/neo4j';
import { VendorsController } from '../src/vendors/vendors.controller';
import { VendorsService } from '../src/vendors/vendors.service';
import { ServiceGraphRepository } from '../src/infra/graph/service-graph.repository';
import { AttributeSetRegistry } from '../src/attribute-set';
import { DB } from '../src/testing/setup';
import { TEST_ORG_ID, TEST_SESSION } from '../src/testing/test-constants';

const dto = { name: 'Acme Corp', type: 'supplier' };

describe('Vendors (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({
          ...DB,
          entities: [VendorEntity, FileEntity],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([VendorEntity, FileEntity]),
      ],
      controllers: [VendorsController],
      providers: [
        VendorsService,
        ServiceGraphRepository,
        AttributeSetRegistry,
        {
          provide: Neo4jService,
          useValue: { write: () => Promise.resolve(null) },
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
  });

  afterAll(() => app.close());

  afterEach(() =>
    dataSource
      .getRepository(VendorEntity)
      .delete({ organizationId: TEST_ORG_ID }),
  );

  async function create(overrides = {}) {
    const res = await request(app.getHttpServer())
      .post('/vendors')
      .send({ ...dto, ...overrides });
    return res.body.data as VendorEntity;
  }

  it('responses are wrapped in { success, data, message, status }', async () => {
    const res = await request(app.getHttpServer()).get('/vendors').expect(200);
    expect(res.body).toMatchObject({
      success: true,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data: expect.any(Array),
      message: 'success',
      status: 200,
    });
  });

  it('POST /vendors â†’ 201 creates vendor', async () => {
    const res = await request(app.getHttpServer())
      .post('/vendors')
      .send(dto)
      .expect(201);
    expect(res.body.data).toMatchObject({
      name: 'Acme Corp',
      organizationId: TEST_ORG_ID,
    });
  });

  it('GET /vendors â†’ 200 list', async () => {
    await create();
    await create({ name: 'Other Corp' });
    const res = await request(app.getHttpServer()).get('/vendors').expect(200);
    expect(res.body.data).toHaveLength(2);
  });

  it('GET /vendors/:id â†’ 200 single vendor', async () => {
    const vendor = await create();
    const res = await request(app.getHttpServer())
      .get(`/vendors/${vendor.id}`)
      .expect(200);
    expect(res.body.data.id).toBe(vendor.id);
  });

  it('GET /vendors/:id â†’ 404 when not found', async () => {
    await request(app.getHttpServer())
      .get('/vendors/00000000-0000-0000-0000-000000000000')
      .expect(404);
  });

  it('PATCH /vendors/:id â†’ 200 updates name', async () => {
    const vendor = await create();
    await request(app.getHttpServer())
      .patch(`/vendors/${vendor.id}`)
      .send({ name: 'Updated Corp' })
      .expect(200);
    const res = await request(app.getHttpServer()).get(`/vendors/${vendor.id}`);
    expect(res.body.data.name).toBe('Updated Corp');
  });

  it('DELETE /vendors/:id â†’ 204 soft deletes, vendor no longer findable', async () => {
    const vendor = await create();
    await request(app.getHttpServer())
      .delete(`/vendors/${vendor.id}`)
      .expect(204);
    await request(app.getHttpServer()).get(`/vendors/${vendor.id}`).expect(404);
  });
});
