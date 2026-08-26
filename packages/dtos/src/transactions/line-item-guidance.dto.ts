import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// Body for POST /transaction/documents/:documentId/line-items/:lineItemId/guidance —
// a reviewer's natural-language correction for one line item. Stored on the node and
// re-applied on every future rerun.
export class LineItemGuidanceDto {
  @ApiProperty({
    description: 'What the system got wrong on this line, in the reviewer\'s words.',
  })
  @IsString()
  @IsNotEmpty()
  guidance!: string;
}
