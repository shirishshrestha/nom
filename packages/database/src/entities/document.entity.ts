import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DOCUMENT_STATUSES } from '@nom/shared';
import type { DocumentMetadata, DocumentStatus, DocumentType } from '@nom/shared';
import { OrganizationScopedEntity } from './mixins/organization-scoped.entity';
import { FileEntity } from './file.entity';
import { VendorEntity } from './vendor.entity';

// One ingested document (source or transaction). Authoritative store for the
// extracted metadata + processing status; sectionized text lives in ContentEntity.
@Entity('documents')
export class DocumentEntity extends OrganizationScopedEntity {
  @ApiProperty({ description: 'Source file this document was extracted from.' })
  @Column({ type: 'uuid' })
  fileId!: string;

  @ApiPropertyOptional({ description: 'Vendor the document belongs to.' })
  @Column({ type: 'uuid', nullable: true })
  vendorId?: string;

  @ApiProperty({ description: 'Document type (source or transaction), inherited from the file.' })
  @Column({ type: 'text' })
  documentType!: DocumentType;

  @ApiPropertyOptional({ description: 'Classified attribute-set key, or null if unclassified.' })
  @Column({ type: 'text', nullable: true })
  attributeSet?: string;

  @ApiProperty({ description: 'Pipeline status (extracted → validated → staged → committed).' })
  @Column({ type: 'text', default: DOCUMENT_STATUSES.PENDING })
  status!: DocumentStatus;

  @ApiProperty({ description: 'Extracted document metadata.' })
  @Column({ type: 'jsonb', default: {} })
  metadata!: DocumentMetadata;

  @ApiProperty({ type: [String], description: 'Non-fatal validation warnings.' })
  @Column({ type: 'jsonb', default: [] })
  warnings!: string[];

  @ApiPropertyOptional({ description: 'Reason the document was rejected, if any.' })
  @Column({ type: 'text', nullable: true })
  rejectReason?: string;

  @ApiProperty({
    description:
      'Reviewer has marked this document review complete (transaction docs).',
  })
  @Column({ type: 'boolean', default: false })
  reviewCompleted!: boolean;

  @ApiPropertyOptional({ description: 'Start of the document’s effective window.' })
  @Column({ type: 'timestamptz', nullable: true })
  effectiveFrom?: Date;

  @ApiPropertyOptional({ description: 'End of the document’s effective window.' })
  @Column({ type: 'timestamptz', nullable: true })
  effectiveTo?: Date;

  @ApiPropertyOptional({ type: () => FileEntity })
  @ManyToOne(() => FileEntity, { nullable: true })
  @JoinColumn({ name: 'fileId' })
  file?: FileEntity;

  @ApiPropertyOptional({ type: () => VendorEntity })
  @ManyToOne(() => VendorEntity, { nullable: true })
  @JoinColumn({ name: 'vendorId' })
  vendor?: VendorEntity;
}
