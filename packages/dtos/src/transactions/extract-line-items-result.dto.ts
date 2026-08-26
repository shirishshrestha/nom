import { ApiProperty } from '@nestjs/swagger';
import type { DocumentStatus } from '@nom/shared';
import { AttributeSetDto } from '../documents/attribute-set.dto';
import { LineItemDto } from './line-item.dto';

// Returned by POST /transaction/documents/:id/extract-line-items. `attributeSet`
// embeds the set definition so the client renders the per-line attribute fields
// dynamically without a second call.
export class ExtractLineItemsResultDto {
  @ApiProperty({ example: 'uuid' })
  documentId!: string;

  @ApiProperty({ example: 'committed', description: 'Document status after extraction.' })
  status!: DocumentStatus;

  @ApiProperty()
  fileName!: string;

  @ApiProperty({ type: AttributeSetDto })
  attributeSet!: AttributeSetDto;

  @ApiProperty({ type: [LineItemDto] })
  lineItems!: LineItemDto[];
}
