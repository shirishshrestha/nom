import { Column, Entity, Index } from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { STAGED_ORIGINS, STAGED_STATUSES } from '@nom/shared';
import type { StagedOrigin, StagedService, StagedStatus } from '@nom/shared';
import { OrganizationScopedEntity } from './mixins/organization-scoped.entity';

// A versioned snapshot of services extracted from one source document, staged for
// human review before promotion to Neo4j. Re-extract / save each insert a new row
// (version = max + 1 per documentId), keeping full history. The graph back-points
// to the originating row via :Service.stagingId / stagingVersion.
@Index(['organizationId', 'documentId', 'version'])
@Entity('staged_service_extractions')
export class StagedServiceExtractionEntity extends OrganizationScopedEntity {
  @ApiProperty()
  @Column({ type: 'uuid' })
  documentId!: string;

  @ApiProperty()
  @Column({ type: 'uuid' })
  fileId!: string;

  @ApiProperty()
  @Column({ type: 'text' })
  fileName!: string;

  @ApiPropertyOptional()
  @Column({ type: 'uuid', nullable: true })
  vendorId?: string;

  @ApiProperty()
  @Column({ type: 'text' })
  attributeSet!: string;

  @ApiProperty({ type: Number })
  @Column({ type: 'int' })
  version!: number;

  @ApiProperty()
  @Column({ type: 'text', default: STAGED_ORIGINS.EXTRACT })
  origin!: StagedOrigin;

  @ApiProperty()
  @Column({ type: 'jsonb', default: [] })
  services!: StagedService[];

  @ApiProperty()
  @Column({ type: 'text', default: STAGED_STATUSES.STAGED })
  status!: StagedStatus;

  @ApiPropertyOptional()
  @Column({ type: 'timestamptz', nullable: true })
  committedAt?: Date;
}
