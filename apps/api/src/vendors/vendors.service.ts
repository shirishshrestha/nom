import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { DocumentEntity, FileEntity, VendorEntity } from '@nom/database';
import { Neo4jService } from '@nom/neo4j';
import { DOCUMENT_TYPES } from '@nom/shared';
import type { DocumentType, ServiceModel } from '@nom/shared';
import {
  CreateVendorDto,
  CurrentServicesResultDto,
  UpdateVendorDto,
} from '@nom/dtos';
import { ServiceGraphRepository } from '../infra/graph/service-graph.repository';
import { AttributeSetRegistry, toAttributeSetDto } from '../attribute-set';
import type { OrgSession } from '../auth/auth.types.js';

@Injectable()
export class VendorsService {
  private readonly logger = new Logger(VendorsService.name);

  constructor(
    @InjectRepository(VendorEntity)
    private readonly vendorsRepo: Repository<VendorEntity>,
    @InjectRepository(FileEntity)
    private readonly filesRepo: Repository<FileEntity>,
    @InjectRepository(DocumentEntity)
    private readonly documentsRepo: Repository<DocumentEntity>,
    private readonly neo4j: Neo4jService,
    private readonly serviceGraph: ServiceGraphRepository,
    private readonly attributeSets: AttributeSetRegistry,
  ) {}

  // Rejects a create/update that would collide with an existing (non-deleted)
  // vendor on the (name, code, type) combination within the org. IsNull() is
  // used for absent code/type — findOneBy would otherwise drop the condition
  // for `undefined` and match on name alone.
  private async assertUnique(
    organizationId: string,
    fields: { name: string; code?: string; type?: string },
    excludeId?: string,
  ) {
    const existing = await this.vendorsRepo.findOne({
      where: {
        organizationId,
        name: fields.name,
        code: fields.code ?? IsNull(),
        type: fields.type ?? IsNull(),
        ...(excludeId ? { id: Not(excludeId) } : {}),
      },
    });
    if (existing)
      throw new BadRequestException(
        'A vendor with this name, code and type already exists.',
      );
  }

  async create(session: OrgSession, dto: CreateVendorDto) {
    const organizationId = session.session.activeOrganizationId;
    await this.assertUnique(organizationId, dto);
    const vendor = await this.vendorsRepo.save(
      this.vendorsRepo.create({ ...dto, organizationId }),
    );

    try {
      await this.neo4j.write(
        'CREATE (v:Vendor {id: $id, tenantId: $tenantId}) RETURN v',
        { id: vendor.id, tenantId: organizationId },
      );
    } catch (e) {
      // The :Vendor node is required: without it, commitServices skips the OFFERS
      // edge and the vendor's rate card later reads back empty. Roll back the
      // Postgres row so the two stores can't diverge, then surface the failure.
      await this.vendorsRepo.delete({ id: vendor.id, organizationId });
      this.logger.error(
        `Neo4j vendor mirror failed for ${vendor.id}; rolled back: ${(e as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'Vendor graph mirror failed; vendor not created',
      );
    }

    this.logger.log(`created vendor=${vendor.id} org=${organizationId}`);
    return vendor;
  }

  findAll(session: OrgSession) {
    return this.vendorsRepo.findBy({
      organizationId: session.session.activeOrganizationId,
    });
  }

  async findOne(session: OrgSession, id: string) {
    const vendor = await this.vendorsRepo.findOneBy({
      id,
      organizationId: session.session.activeOrganizationId,
    });
    if (!vendor) throw new NotFoundException('Vendor not found');
    return vendor;
  }

  async listVendorTypes(session: OrgSession) {
    const rows = await this.vendorsRepo
      .createQueryBuilder('v')
      .select('DISTINCT v.type', 'type')
      .where('v.organizationId = :organizationId', {
        organizationId: session.session.activeOrganizationId,
      })
      .andWhere('v.type IS NOT NULL')
      .getRawMany<{ type: string }>();
    return rows.map((r) => r.type);
  }

  // Reads a page of the live rate card (grouped by canonical, after amendment
  // chains); embeds the attribute-set definition so the frontend renders columns
  // without a second call.
  async listCurrentServices(
    session: OrgSession,
    vendorId: string,
    {
      limit,
      offset,
      fileId,
      model,
      q,
    }: {
      limit: number;
      offset: number;
      fileId?: string;
      model?: ServiceModel;
      q?: string;
    },
  ): Promise<CurrentServicesResultDto> {
    const organizationId = session.session.activeOrganizationId;

    // The quotation files a vendor's services could be extracted from — for the
    // file-selection filter, independent of the current page of services.
    const fileRows = await this.filesRepo.find({
      where: {
        vendorId,
        organizationId,
        documentType: DOCUMENT_TYPES.SOURCE,
      },
      order: { createdAt: 'DESC' },
    });
    const files = fileRows.map((f) => ({
      fileId: f.id,
      fileName: f.name,
      uploadDate: f.createdAt.toISOString(),
    }));

    // Resolve the file filter to the graph's documentId anchors. A file with no
    // documents yet matches nothing (rather than falling through to no filter).
    let documentIds: string[] | undefined;
    if (fileId) {
      const docs = await this.documentsRepo.find({
        where: { fileId, organizationId, documentType: DOCUMENT_TYPES.SOURCE },
        select: { id: true },
      });
      documentIds = docs.length ? docs.map((d) => d.id) : ['__none__'];
    }

    const { groupedServices, attributeSet, total } =
      await this.serviceGraph.listCurrentForVendor(organizationId, vendorId, {
        limit,
        offset,
        documentIds,
        model,
        q,
      });
    const attributeSetDef = attributeSet
      ? this.attributeSets.get(attributeSet)
      : undefined;
    this.logger.debug(
      `current services vendor=${vendorId} groups=${groupedServices.length}/${total} limit=${limit} offset=${offset} fileId=${fileId ?? 'all'} model=${model ?? 'all'} q=${q ?? 'none'}`,
    );
    return {
      groupedServices,
      attributeSet: attributeSetDef ? toAttributeSetDto(attributeSetDef) : null,
      files,
      fileCount: files.length,
      total,
      limit,
      offset,
    };
  }

  async findFiles(
    session: OrgSession,
    id: string,
    documentType?: DocumentType,
  ) {
    await this.findOne(session, id);
    return this.filesRepo.findBy({
      vendorId: id,
      organizationId: session.session.activeOrganizationId,
      ...(documentType ? { documentType } : {}),
    });
  }

  async update(session: OrgSession, id: string, dto: UpdateVendorDto) {
    const organizationId = session.session.activeOrganizationId;
    const current = await this.findOne(session, id);
    const merged = { ...current, ...dto };
    await this.assertUnique(
      organizationId,
      { name: merged.name, code: merged.code, type: merged.type },
      id,
    );
    await this.vendorsRepo.update({ id, organizationId }, dto);
    return this.findOne(session, id);
  }

  remove(session: OrgSession, id: string) {
    return this.vendorsRepo.softDelete({
      id,
      organizationId: session.session.activeOrganizationId,
    });
  }
}
