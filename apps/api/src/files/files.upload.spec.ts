import { Test } from '@nestjs/testing';
import { jest } from '@jest/globals';
import { ConfigModule } from '@nestjs/config';
import {
  TypeOrmModule,
  getDataSourceToken,
  getRepositoryToken,
} from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { FileEntity, OrganizationEntity, VendorEntity } from '@nom/database';
import { FilesService } from './files.service';
import { S3Service } from './s3.service';
import { DB } from '../testing/setup';
import { TEST_SESSION, TEST_ORG_ID } from '../testing/test-constants';
import { makeFileDto, FIXTURE_FILE } from '../testing/fixtures';
import { readFileSync } from 'fs';
import type { OrgSession } from '../auth/auth.types';

const session = TEST_SESSION as unknown as OrgSession;

const mockOrgsRepo = {
  findOneBy: jest
    .fn<any>()
    .mockResolvedValue({ id: TEST_ORG_ID, slug: `tests/${TEST_ORG_ID}` }),
};

describe('FilesService — upload lifecycle', () => {
  let service: FilesService;
  let dataSource: DataSource;
  let vendor: VendorEntity;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ envFilePath: ['.env'] }),
        TypeOrmModule.forRoot({
          ...DB,
          entities: [FileEntity, VendorEntity],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([FileEntity, VendorEntity]),
      ],
      providers: [
        FilesService,
        S3Service,
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

  it('presign returns uploadUrl and org-scoped storageKey', async () => {
    const { file, uploadUrl } = await service.presign(session, makeFileDto());
    expect(uploadUrl).toMatch(/^https:\/\//);
    expect(file.storageKey).toMatch(new RegExp(`^tests/${TEST_ORG_ID}/`));
    expect(file.storageKey).toMatch(/\.pdf$/);
    expect(file.sizeBytes).toBeGreaterThan(0);
  });

  it('confirm transitions file to uploaded', async () => {
    const { file } = await service.presign(session, makeFileDto());
    const confirmed = await service.confirm(session, vendor.id, file.id);
    expect(confirmed.status).toBe('uploaded');
  });

  it('getDownloadUrl returns url after confirm', async () => {
    const { file, uploadUrl } = await service.presign(session, makeFileDto());
    await fetch(uploadUrl, {
      method: 'PUT',
      body: readFileSync(FIXTURE_FILE),
      headers: { 'Content-Type': 'application/pdf' },
    });
    await service.confirm(session, vendor.id, file.id);
    const { url } = await service.getDownloadUrl(session, file.id);
    console.log('download url:', url);
    expect(url).toMatch(/^https:\/\//);
  });

  it('confirm throws NotFoundException for unknown id', async () => {
    await expect(
      service.confirm(
        session,
        vendor.id,
        '00000000-0000-0000-0000-000000000000',
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('getDownloadUrl throws NotFoundException for missing file', async () => {
    await expect(
      service.getDownloadUrl(session, '00000000-0000-0000-0000-000000000000'),
    ).rejects.toThrow(NotFoundException);
  });
});
