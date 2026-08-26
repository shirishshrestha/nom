import { ApiProperty } from '@nestjs/swagger';

// Returned by GET /transaction/documents/:documentId/line-items/:lineItemId/logs —
// the full a–z audit trail for one line item, fetched on demand (it is not included
// in the line-items list response). Backed by Postgres pipeline_logs.
export class LineItemLogDto {
  @ApiProperty({ example: 'uuid', description: 'Line item id.' })
  lineItemId!: string;

  @ApiProperty({
    type: [String],
    description: 'Audit trail: what happened to this line through the flow, in order.',
  })
  log!: string[];
}
