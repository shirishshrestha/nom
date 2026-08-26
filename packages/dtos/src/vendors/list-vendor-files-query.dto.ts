import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { DOCUMENT_TYPES } from '@nom/shared';
import type { DocumentType } from '@nom/shared';

// Query params for GET /vendors/:id/files. `documentType` optionally restricts the
// list to files of one type (e.g. source rate cards vs transaction invoices).
export class ListVendorFilesQueryDto {
  @ApiProperty({
    required: false,
    enum: Object.values(DOCUMENT_TYPES),
    description: 'Restrict to files of this document type.',
  })
  @IsOptional()
  @IsIn(Object.values(DOCUMENT_TYPES))
  documentType?: DocumentType;
}
