import { ApiProperty } from '@nestjs/swagger';

// The render-facing shape of an attribute set, embedded as metadata in the source
// responses so the frontend can render columns/fields dynamically without a second
// round-trip. INTERNAL extractor fields (promptContext, description) are deliberately
// omitted — this carries only what the UI needs.

export class AttributeDefDto {
  @ApiProperty({ example: 'price' })
  key!: string;

  @ApiProperty({ example: 'Price' })
  label!: string;

  @ApiProperty({ enum: ['string', 'number'], example: 'number' })
  type!: 'string' | 'number';

  @ApiProperty({ example: false })
  nullable!: boolean;
}

export class AttributeSetDto {
  @ApiProperty({ example: 'quotation' })
  key!: string;

  @ApiProperty({ example: 'Rate card' })
  label!: string;

  @ApiProperty({ example: 'source' })
  documentType!: string;

  @ApiProperty({ type: [AttributeDefDto] })
  attributes!: AttributeDefDto[];
}
