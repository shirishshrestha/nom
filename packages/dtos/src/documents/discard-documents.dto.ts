import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import type { DocumentStatus } from '@nom/shared';

// Input to POST /source/discard — discards a vendor's entire uncommitted
// change-set (one or more docs) in a single call.
export class DiscardDocumentsDto {
  @ApiProperty({
    example: 'uuid',
    description: 'Vendor whose uncommitted change-set should be discarded.',
  })
  @IsUUID('4')
  vendorId!: string;
}

// Returned after the vendor's uncommitted documents are discarded. `documentIds`
// is empty when the vendor had nothing in review (no-op).
export class DiscardDocumentsResultDto {
  @ApiProperty({
    type: [String],
    description: 'Ids of the discarded documents (empty when it was a no-op).',
  })
  documentIds!: string[];

  @ApiProperty({ description: 'Resulting document status (discarded).' })
  status!: DocumentStatus;
}
