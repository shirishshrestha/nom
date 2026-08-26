import { ApiProperty } from '@nestjs/swagger';

// A single content chunk (ContentEntity) fetched on demand to show where a
// service line was extracted from. The `sourceText` phrase that locates the line
// within this chunk stays on the service's meta.
export class ContentChunkDto {
  @ApiProperty({ example: 'uuid', description: 'Content chunk id.' })
  id!: string;

  @ApiProperty({ description: "The chunk's heading or derived topic label." })
  label!: string;

  @ApiProperty({ description: 'Verbatim text of this content chunk.' })
  text!: string;

  @ApiProperty({
    type: Number,
    description: 'Zero-based position of the chunk within the document.',
  })
  position!: number;

  @ApiProperty({
    description: 'Original uploaded file name of the source document.',
  })
  fileName!: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: '1-based page number this chunk was found on; null if unknown.',
  })
  page!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: "Total page count of the source document; null if unknown.",
  })
  totalPages!: number | null;
}
