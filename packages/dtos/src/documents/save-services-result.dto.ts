import { ApiProperty } from '@nestjs/swagger';
import type { DocumentStatus } from '@nom/shared';

// Returned by POST /documents/:id/save-services after the staged services are
// promoted into Neo4j.
export class SaveServicesResultDto {
  @ApiProperty({ example: 'uuid' })
  documentId!: string;

  @ApiProperty({ type: Number })
  version!: number;

  @ApiProperty({ type: Number })
  canonicalCount!: number;

  @ApiProperty({ type: Number })
  serviceCount!: number;

  @ApiProperty()
  status!: DocumentStatus;
}
