import { IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// Body for POST /transaction/documents/:documentId/line-items/:lineItemId/accept —
// a reviewer accepting a line's discrepancy as-is. The reason is optional and folded
// into the audit-log entry for compliance reporting.
export class AcceptLineItemDto {
  @ApiProperty({
    required: false,
    description: 'Why the discrepancy is being accepted, in the reviewer\'s words.',
  })
  @IsOptional()
  @IsString()
  reasonForAcceptance?: string;
}
