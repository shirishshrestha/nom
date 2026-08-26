import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { DocumentMetadata, DocumentStatus } from '@nom/shared';

export class ValidateDocumentResultDto {
  @ApiProperty({ example: 'uuid', description: 'Validated document id.' })
  id!: string;

  @ApiProperty({ description: 'Document status after validation (validated).' })
  status!: DocumentStatus;

  @ApiProperty({
    type: [String],
    description: 'Non-fatal validation warnings, e.g. an unmatched vendor.',
  })
  warnings!: string[];

  @ApiProperty({ description: 'Extracted document metadata, with vendor-match result.' })
  metadata!: DocumentMetadata;

  @ApiPropertyOptional({ description: 'Why the document was rejected; present only when status is rejected.' })
  rejectReason?: string;
}
