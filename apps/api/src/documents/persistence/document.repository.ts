import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DocumentEntity } from '@nom/database';
import { DOCUMENT_STATUSES } from '@nom/shared';
import type { DocumentMetadata, DocumentType } from '@nom/shared';

// Custom repository for DocumentEntity — keeps QueryBuilder/SQL out of the
// service layer (which depends only on these named, intention-revealing methods).
@Injectable()
export class DocumentRepository {
  constructor(
    @InjectRepository(DocumentEntity)
    private readonly repo: Repository<DocumentEntity>,
  ) {}

  findOneScoped(
    organizationId: string,
    id: string,
  ): Promise<DocumentEntity | null> {
    return this.repo.findOneBy({ id, organizationId });
  }

  // Oldest accepted prior document for the same vendor + type (excluding the
  // current one), or null if none exists. Anchors the attributeSet-mismatch
  // check: only docs past the validation gate (VALIDATED/STAGED/COMMITTED)
  // count, so their classification was actually accepted.
  async findOldestDocumentForVendor(args: {
    vendorId: string;
    documentType: DocumentType;
    excludeId: string;
  }): Promise<DocumentMetadata | null> {
    const row = await this.repo
      .createQueryBuilder('d')
      .select('d.metadata', 'metadata')
      .where('d.vendorId = :vendorId', { vendorId: args.vendorId })
      .andWhere('d.documentType = :documentType', {
        documentType: args.documentType,
      })
      .andWhere('d.id != :id', { id: args.excludeId })
      .andWhere('d.status IN (:...anchored)', {
        anchored: [
          DOCUMENT_STATUSES.VALIDATED,
          DOCUMENT_STATUSES.STAGED,
          DOCUMENT_STATUSES.COMMITTED,
        ],
      })
      .orderBy('d.createdAt', 'ASC')
      .limit(1)
      .getRawOne<{ metadata: DocumentMetadata }>();
    return row?.metadata ?? null;
  }

  // Most-recent accepted prior document (by effective date) for the same vendor +
  // type, excluding the current one, or null. Anchors the outdated-upload check:
  // a new source document dated before this one is rejected.
  async findLatestDocumentForVendor(args: {
    vendorId: string;
    documentType: DocumentType;
    excludeId: string;
  }): Promise<DocumentEntity | null> {
    return this.repo
      .createQueryBuilder('d')
      .where('d.vendorId = :vendorId', { vendorId: args.vendorId })
      .andWhere('d.documentType = :documentType', {
        documentType: args.documentType,
      })
      .andWhere('d.id != :id', { id: args.excludeId })
      .andWhere('d.status IN (:...anchored)', {
        anchored: [
          DOCUMENT_STATUSES.VALIDATED,
          DOCUMENT_STATUSES.STAGED,
          DOCUMENT_STATUSES.COMMITTED,
        ],
      })
      .andWhere('d.effectiveFrom IS NOT NULL')
      .orderBy('d.effectiveFrom', 'DESC')
      .limit(1)
      .getOne();
  }
}
