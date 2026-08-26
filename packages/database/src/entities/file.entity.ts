import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { FILE_CATEGORIES, FILE_STATUSES } from '@nom/shared';
import type { DocumentType, FileCategory, FileStatus } from '@nom/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrganizationScopedEntity } from './mixins/organization-scoped.entity';
import { VendorEntity } from './vendor.entity';

@Entity('files')
export class FileEntity extends OrganizationScopedEntity {
  @ApiProperty({ description: 'Original file name.' })
  @Column({ type: 'text' })
  name!: string;

  @ApiProperty({ description: 'S3 object key the file is stored under.' })
  @Column({ type: 'text' })
  storageKey!: string;

  @ApiProperty({ description: 'MIME type, e.g. application/pdf.' })
  @Column({ type: 'text' })
  mimeType!: string;

  @ApiProperty({ type: Number, description: 'File size in bytes.' })
  @Column({ type: 'int' })
  sizeBytes!: number;

  @ApiProperty({ description: 'Document type the file holds (source or transaction).' })
  @Column({ type: 'text' })
  documentType!: DocumentType;

  @ApiProperty({ description: 'File category (defaults to document).' })
  @Column({ type: 'text', default: FILE_CATEGORIES.DOCUMENT })
  category!: FileCategory;

  @ApiProperty({ description: 'Upload lifecycle status (pending → uploaded).' })
  @Column({ type: 'text', default: FILE_STATUSES.PENDING })
  status!: FileStatus;

  @ApiPropertyOptional({ description: 'Free-form metadata about the file.' })
  @Column({ type: 'jsonb', nullable: true })
  meta?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Vendor the file is linked to, once confirmed.' })
  @Column({ type: 'uuid', nullable: true })
  vendorId?: string;
  
  @ApiPropertyOptional({ type: () => VendorEntity})
  @ManyToOne(() => VendorEntity, (vendor) => vendor.files, { nullable: true })
  @JoinColumn({ name: 'vendorId' })
  vendor?: VendorEntity;
}
