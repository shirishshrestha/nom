import { jest } from '@jest/globals';
import { FilesService } from '@/files/files.service';
import { S3Service } from '@/files/s3.service';
import { DB } from '@/testing/setup';
import { mockOrgsRepo, mockS3 } from '@/testing/mocks';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  VendorEntity,
  OrganizationEntity,
  FileEntity,
  DocumentEntity,
} from '@nom/database';
import { VendorsService } from './vendors.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { Neo4jModule, Neo4jService } from '@nom/neo4j';
import { ServiceGraphRepository } from '@/infra/graph/service-graph.repository';
import { AttributeSetRegistry } from '@/attribute-set';
import { TEST_ORG_ID, TEST_SESSION } from '@/testing/test-constants';
import { CreateVendorDto } from '@nom/dtos';
import { OrgSession } from '@/auth/auth.types';

describe('VendorsService', () => {
  let module: TestingModule;
  let service: VendorsService;
  let neo4j: Neo4jService;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          ...DB,
          entities: [
            VendorEntity,
            OrganizationEntity,
            FileEntity,
            DocumentEntity,
          ],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([VendorEntity, FileEntity, DocumentEntity]),
        Neo4jModule,
      ],
      providers: [
        FilesService,
        VendorsService,
        ServiceGraphRepository,
        AttributeSetRegistry,
        { provide: S3Service, useValue: mockS3 },
        {
          provide: getRepositoryToken(OrganizationEntity),
          useValue: mockOrgsRepo,
        },
      ],
    }).compile();

    service = module.get<VendorsService>(VendorsService);
    neo4j = module.get<Neo4jService>(Neo4jService);
  });

  afterAll(() => module.close());

  afterEach(async () => {
    await neo4j.write(
      'MATCH (v:Vendor {tenantId: $tenantId}) DETACH DELETE v',
      {
        tenantId: TEST_ORG_ID,
      },
    );
    // Hard-delete so the persistent test DB stays isolated between runs — the
    // (name, code, type) uniqueness guard would otherwise trip on leftover rows.
    await module
      .get<Repository<VendorEntity>>(getRepositoryToken(VendorEntity))
      .delete({ organizationId: TEST_ORG_ID });
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create a vendor and add it to Neo4j', async () => {
    const dto: CreateVendorDto = {
      name: 'Test Vendor',
      type: 'Test Type',
      comments: 'Test Comments',
    };

    const session = TEST_SESSION as OrgSession;
    const createdService = await service.create(session, dto);
    expect(createdService).toBeDefined();
    expect(createdService.name).toBe(dto.name);
  });

  it('rolls back the Postgres vendor when the Neo4j mirror fails', async () => {
    const session = TEST_SESSION as OrgSession;
    const before = (await service.findAll(session)).length;

    const spy = jest
      .spyOn(neo4j, 'write')
      .mockRejectedValueOnce(new Error('neo4j down'));

    const dto: CreateVendorDto = {
      name: 'Rollback Co',
      type: 'X',
      comments: '',
    };
    await expect(service.create(session, dto)).rejects.toThrow(
      'Vendor graph mirror failed',
    );
    spy.mockRestore();

    // Postgres row was rolled back — no orphan, count unchanged.
    const after = await service.findAll(session);
    expect(after.length).toBe(before);
    expect(after.find((v) => v.name === 'Rollback Co')).toBeUndefined();
  });

  it('should find all vendors for an organization', async () => {
    const session = TEST_SESSION as OrgSession;

    const vendors = await service.findAll(session);
    expect(vendors).toBeDefined();
    expect(Array.isArray(vendors)).toBe(true);
  });

  it('should find a vendor by ID', async () => {
    const session = TEST_SESSION as OrgSession;

    const dto: CreateVendorDto = {
      name: 'Find By Id Vendor',
      type: 'Test Type',
      comments: 'Test Comments',
    };

    const createdVendor = await service.create(session, dto);

    const foundVendor = await service.findOne(session, createdVendor.id);
    expect(foundVendor).toBeDefined();
    expect(foundVendor.id).toBe(createdVendor.id);
  });

  it('should throw NotFoundException if vendor not found', async () => {
    const session = TEST_SESSION as OrgSession;

    await expect(
      service.findOne(session, '00000000-0000-0000-0000-000000000000'),
    ).rejects.toThrow('Vendor not found');
  });

  it('should get all the files for a vendor', async () => {
    const session = TEST_SESSION as OrgSession;

    const dto: CreateVendorDto = {
      name: 'Files Vendor',
      type: 'Test Type',
      comments: 'Test Comments',
    };

    const createdVendor = await service.create(session, dto);

    const files = await service.findFiles(session, createdVendor.id);
    expect(files).toBeDefined();
    expect(Array.isArray(files)).toBe(true);
  });

  it('passes pagination through and resolves the attribute set from the registry', async () => {
    const session = TEST_SESSION as OrgSession;
    const graph = module.get(ServiceGraphRepository);
    const spy = jest.spyOn(graph, 'listCurrentForVendor').mockResolvedValue({
      groupedServices: [
        {
          canonicalName: 'local_haulage',
          canonicalDescription: 'Trucking.',
          category: 'Haulage',
          services: [],
        },
      ],
      attributeSet: 'quotation',
      total: 3,
    });

    const res = await service.listCurrentServices(
      session,
      '00000000-0000-0000-0000-000000000001',
      {
        limit: 2,
        offset: 0,
      },
    );

    expect(spy).toHaveBeenCalledWith(
      TEST_ORG_ID,
      '00000000-0000-0000-0000-000000000001',
      {
        limit: 2,
        offset: 0,
        documentIds: undefined,
        model: undefined,
      },
    );
    expect(res.groupedServices).toHaveLength(1);
    expect(res.total).toBe(3);
    expect(res.limit).toBe(2);
    expect(res.offset).toBe(0);
    expect(res.attributeSet?.key).toBe('quotation');
    spy.mockRestore();
  });

  it('rejects creating a vendor with a duplicate (name, code, type)', async () => {
    const session = TEST_SESSION as OrgSession;
    const dto: CreateVendorDto = {
      name: 'Insurance Corp Asia',
      code: 'ICA',
      type: 'Insurance',
    };
    await service.create(session, dto);

    await expect(service.create(session, dto)).rejects.toThrow(
      'A vendor with this name, code and type already exists.',
    );
  });

  it('rejects updating a vendor to collide with another (name, code, type)', async () => {
    const session = TEST_SESSION as OrgSession;
    await service.create(session, { name: 'Alpha Co', code: 'A', type: 'T' });
    const beta = await service.create(session, {
      name: 'Beta Co',
      code: 'B',
      type: 'T',
    });

    await expect(
      service.update(session, beta.id, { name: 'Alpha Co', code: 'A' }),
    ).rejects.toThrow('A vendor with this name, code and type already exists.');
  });

  it('allows updating a vendor to its own current values', async () => {
    const session = TEST_SESSION as OrgSession;
    const vendor = await service.create(session, {
      name: 'Gamma Co',
      code: 'G',
      type: 'T',
    });

    const updated = await service.update(session, vendor.id, {
      name: 'Gamma Co',
      comments: 'touched',
    });
    expect(updated.comments).toBe('touched');
  });

  it('returns a null attribute set when the vendor has no committed services', async () => {
    const session = TEST_SESSION as OrgSession;
    const graph = module.get(ServiceGraphRepository);
    const spy = jest
      .spyOn(graph, 'listCurrentForVendor')
      .mockResolvedValue({ groupedServices: [], attributeSet: null, total: 0 });

    const res = await service.listCurrentServices(
      session,
      '00000000-0000-0000-0000-000000000001',
      {
        limit: 20,
        offset: 0,
      },
    );

    expect(res.groupedServices).toEqual([]);
    expect(res.total).toBe(0);
    expect(res.attributeSet).toBeNull();
    spy.mockRestore();
  });
});
