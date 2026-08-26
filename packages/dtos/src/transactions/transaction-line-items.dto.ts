import { ApiProperty } from '@nestjs/swagger';
import { LineItemDto } from './line-item.dto';

// Returned by GET /transaction/documents/:id/line-items — the line items read back
// from the graph, grouped by invoice in document order.
export class TransactionLineItemsDto {
  @ApiProperty({ example: 'uuid' })
  documentId!: string;

  @ApiProperty({ type: [LineItemDto] })
  lineItems!: LineItemDto[];
}
