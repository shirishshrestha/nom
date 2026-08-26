import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { UpdateFileDto, PresignFileDto } from '@nom/dtos';
import { In, Repository } from 'typeorm';
import { FileEntity, OrganizationEntity, VendorEntity } from '@nom/database';
import { FILE_STATUSES } from '@nom/shared';
import { randomUUID } from 'crypto';
import type { OrgSession } from '../auth/auth.types.js';
import { S3Service } from './s3.service.js';

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    @InjectRepository(FileEntity)
    private readonly filesRepo: Repository<FileEntity>,
    @InjectRepository(OrganizationEntity)
    private readonly orgsRepo: Repository<OrganizationEntity>,
    @InjectRepository(VendorEntity)
    private readonly vendorsRepo: Repository<VendorEntity>,
    private readonly s3: S3Service,
  ) {}

  // Uploads are limited to the document types the extraction pipeline can read.
  private static readonly ALLOWED_MIME = new Set([
    'application/pdf',
    'image/png',
    'image/jpeg',
  ]);

  // Confirm a file belongs to a vendor in the caller's org, else 404.
  private async assertVendorInOrg(vendorId: string, organizationId: string) {
    const vendor = await this.vendorsRepo.findOneBy({
      id: vendorId,
      organizationId,
    });
    if (!vendor) throw new NotFoundException('Vendor not found');
  }

  async presign(session: OrgSession, dto: PresignFileDto) {
    const organizationId = session.session.activeOrganizationId;
    const org = await this.orgsRepo.findOneBy({ id: organizationId });
    if (!org) throw new NotFoundException('Organization not found');

    if (!FilesService.ALLOWED_MIME.has(dto.mimeType))
      throw new BadRequestException(`Unsupported file type: ${dto.mimeType}`);

    const ext = dto.name.split('.').pop();
    const storageKey = `${org.slug}/${randomUUID()}.${ext}`;

    const file = await this.filesRepo.save(
      this.filesRepo.create({
        ...dto,
        storageKey,
        organizationId,
        status: FILE_STATUSES.PENDING,
      }),
    );

    const uploadUrl = await this.s3.getPresignedPutUrl(
      storageKey,
      dto.mimeType,
    );
    this.logger.log(
      `presigned file=${file.id} org=${organizationId} mime=${dto.mimeType}`,
    );
    return { file, uploadUrl };
  }

  async confirm(session: OrgSession, vendorId: string, id: string) {
    const organizationId = session.session.activeOrganizationId;
    const file = await this.filesRepo.findOneBy({ id, organizationId });
    if (!file) throw new NotFoundException('File not found');
    await this.assertVendorInOrg(vendorId, organizationId);

    await this.filesRepo.update(
      { id, organizationId },
      {
        status: FILE_STATUSES.UPLOADED,
        vendorId,
      },
    );
    this.logger.log(`confirmed file=${id} vendor=${vendorId}`);
    return { ...file, status: FILE_STATUSES.UPLOADED, vendorId };
  }

  async confirmMany(session: OrgSession, vendorId: string, ids: string[]) {
    const organizationId = session.session.activeOrganizationId;
    const files = await this.filesRepo.findBy({ id: In(ids), organizationId });
    if (files.length !== ids.length)
      throw new NotFoundException('Files not found');
    await this.assertVendorInOrg(vendorId, organizationId);
    await this.filesRepo.update(
      { id: In(ids), organizationId },
      {
        status: FILE_STATUSES.UPLOADED,
        vendorId,
      },
    );
    this.logger.log(`confirmed ${ids.length} file(s) vendor=${vendorId}`);
    return files.map((file) => ({
      ...file,
      status: FILE_STATUSES.UPLOADED,
      vendorId,
    }));
  }

  async getDownloadUrl(session: OrgSession, id: string) {
    const organizationId = session.session.activeOrganizationId;
    const file = await this.filesRepo.findOneBy({ id, organizationId });
    if (!file) throw new NotFoundException('File not found');

    const url = await this.s3.getPresignedGetUrl(file.storageKey);
    return { url };
  }

  findAll(session: OrgSession) {
    return this.filesRepo.find({
      where: { organizationId: session.session.activeOrganizationId },
    });
  }

  async findOne(session: OrgSession, id: string) {
    const file = await this.filesRepo.findOneBy({
      id,
      organizationId: session.session.activeOrganizationId,
    });
    if (!file) throw new NotFoundException('File not found');
    return file;
  }

  async update(session: OrgSession, id: string, updateFileDto: UpdateFileDto) {
    const organizationId = session.session.activeOrganizationId;
    await this.findOne(session, id); // 404 if not in caller's org
    return this.filesRepo.update({ id, organizationId }, updateFileDto);
  }

  remove(session: OrgSession, id: string) {
    return this.filesRepo.softDelete({
      id,
      organizationId: session.session.activeOrganizationId,
    });
  }
}
