import { ApiProperty } from '@nestjs/swagger';
import { DocumentMetadata, DocumentStatus } from '@nom/shared';

export class ExtractResultDto {
  @ApiProperty({ example: 'uuid', description: 'Created document id.' })
  documentId!: string;

  @ApiProperty({ example: 'uuid', description: 'Source file id.' })
  fileId!: string;

  @ApiProperty({ example: 'extracted', description: 'Document status after extraction.' })
  status!: DocumentStatus;

  @ApiProperty({ type: 'object', additionalProperties: true, description: 'Extracted document metadata.' })
  metadata!: DocumentMetadata;
}
