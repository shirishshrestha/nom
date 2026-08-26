import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  TypeOrmModule,
  getDataSourceToken,
  getRepositoryToken,
} from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DOCUMENT_TYPES, FILE_CATEGORIES, FILE_STATUSES } from '@nom/shared';
import { FileEntity, OrganizationEntity, VendorEntity } from '@nom/database';
import { FilesService } from './files.service';
import { S3Service } from './s3.service';
import { DB } from '@/testing/setup';
import { TEST_SESSION, TEST_ORG_ID } from '@/testing/test-constants';
import { mockOrgsRepo, mockS3 } from '@/testing/mocks';
import type { OrgSession } from '@/auth/auth.types';

const session = TEST_SESSION as unknown as OrgSession;

const baseDto = {
  name: 'report.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 2048,
  documentType: DOCUMENT_TYPES.SOURCE,
  category: FILE_CATEGORIES.DOCUMENT,
};

describe('FilesService', () => {
  let service: FilesService;
  let dataSource: DataSource;
  let vendor: VendorEntity;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          ...DB,
          entities: [FileEntity, VendorEntity, OrganizationEntity],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([FileEntity, VendorEntity]),
      ],
      providers: [
        FilesService,
        { provide: S3Service, useValue: mockS3 },
        {
          provide: getRepositoryToken(OrganizationEntity),
          useValue: mockOrgsRepo,
        },
      ],
    }).compile();

    service = module.get(FilesService);
    dataSource = module.get<DataSource>(getDataSourceToken());
    vendor = await dataSource
      .getRepository(VendorEntity)
      .save({ name: 'Test Vendor', organizationId: TEST_ORG_ID });
  });

  afterAll(async () => {
    await dataSource
      .getRepository(VendorEntity)
      .delete({ organizationId: TEST_ORG_ID });
    await dataSource.destroy();
  });

  afterEach(() =>
    dataSource
      .getRepository(FileEntity)
      .delete({ organizationId: TEST_ORG_ID }),
  );

  it('presign creates a pending file', async () => {
    const { file } = await service.presign(session, baseDto);
    expect(file.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(file.name).toBe('report.pdf');
    expect(file.status).toBe('pending');
    expect(file.organizationId).toBe(TEST_ORG_ID);
  });

  it('findAll returns only files for the session org', async () => {
    await service.presign(session, baseDto);
    await service.presign(session, { ...baseDto, name: 'other.pdf' });
    const files = await service.findAll(session);
    expect(files.length).toBe(2);
    expect(files.every((f) => f.organizationId === TEST_ORG_ID)).toBe(true);
  });

  it('findOne returns the correct file', async () => {
    const { file: created } = await service.presign(session, baseDto);
    const found = await service.findOne(session, created.id);
    expect(found?.id).toBe(created.id);
  });

  it('confirm sets status to uploaded and links vendor', async () => {
    const { file: created } = await service.presign(session, baseDto);
    const confirmed = await service.confirm(session, vendor.id, created.id);
    expect(confirmed.status).toBe('uploaded');
    expect(confirmed.vendorId).toBe(vendor.id);
  });

  it('confirmMany sets status to uploaded and links vendor', async () => {
    const { file: created } = await service.presign(session, baseDto);
    const confirmed = await service.confirmMany(session, vendor.id, [
      created.id,
    ]);
    expect(confirmed.every((f) => f.status === FILE_STATUSES.UPLOADED)).toBe(
      true,
    );
    expect(confirmed.every((f) => f.vendorId === vendor.id)).toBe(true);
  });

  it('update persists changes', async () => {
    const { file: created } = await service.presign(session, baseDto);
    await service.update(session, created.id, { name: 'updated.pdf' });
    const found = await service.findOne(session, created.id);
    expect(found?.name).toBe('updated.pdf');
  });

  it('remove soft deletes — file no longer findable', async () => {
    const { file: created } = await service.presign(session, baseDto);
    const result = await service.remove(session, created.id);
    expect(result.affected).toBe(1);
    await expect(service.findOne(session, created.id)).rejects.toThrow(
      NotFoundException,
    );
  });
});
