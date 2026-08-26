import { Column, Entity, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import type { DocumentType } from '@nom/shared';
import { OrganizationScopedEntity } from './mixins/organization-scoped.entity';

// One sectionized chunk of a document's content. Generic across document types;
// the parent is referenced by (documentType, documentId), queryable via metadata.
@Index(['organizationId', 'documentType', 'documentId'])
@Entity('content')
export class ContentEntity extends OrganizationScopedEntity {
  @ApiProperty()
  @Column({ type: 'uuid' })
  documentId!: string;

  @ApiProperty()
  @Column({ type: 'text' })
  documentType!: DocumentType;

  @ApiProperty()
  @Column({ type: 'text' })
  label!: string;

  @ApiProperty()
  @Column({ type: 'text' })
  text!: string;

  // Order within the document (0-based). 'order' is a SQL reserved word.
  @ApiProperty({ type: Number })
  @Column({ type: 'int' })
  position!: number;

  @ApiProperty()
  @Column({ type: 'jsonb', default: {} })
  metadata!: Record<string, unknown>;
}
