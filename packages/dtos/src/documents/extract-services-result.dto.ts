import { ApiProperty } from '@nestjs/swagger';
import type { ReviewService } from '@nom/shared';
import { AttributeSetDto } from './attribute-set.dto';

// Returned by POST /documents/:id/extract-services. `services` is the review-facing
// shape — internal canonical/tier-slug fields are stripped before they reach the
// frontend. `attributeSet` embeds the set definition so the review UI renders fields
// dynamically without a second call.
export class ExtractServicesResultDto {
  @ApiProperty({ example: 'uuid' })
  documentId!: string;

  @ApiProperty({ type: Number })
  version!: number;

  @ApiProperty()
  fileName!: string;

  @ApiProperty({ type: AttributeSetDto })
  attributeSet!: AttributeSetDto;

  @ApiProperty({ type: 'array', items: { type: 'object' } })
  services!: ReviewService[];
}
