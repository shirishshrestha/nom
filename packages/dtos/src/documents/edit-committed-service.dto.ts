import { ApiProperty } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString } from 'class-validator';
import type { ReviewService } from '@nom/shared';
import { AttributeSetDto } from './attribute-set.dto';

// Body of PATCH /documents/:documentId/services/:serviceId — a single committed
// service edit. The service id comes from the path, so it is not in the body.
// Reviewers may change attribute VALUES plus the concept-bearing title /
// pricingContext; everything else is taken server-side from the committed snapshot.
export class EditCommittedServiceDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Reviewed attribute values, keyed by attribute key.',
  })
  @IsObject()
  attributes!: Record<string, string | number | null>;

  @ApiProperty({
    required: false,
    description: 'Edited service title; re-resolves the canonical name at commit.',
  })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({
    required: false,
    description: 'Edited pricing context; also re-resolves the canonical name.',
  })
  @IsOptional()
  @IsString()
  pricingContext?: string;
}

// Returned by GET /documents/:documentId/services — the document's committed
// services (review-facing shape, keeping the service id so the frontend can
// round-trip it as the :serviceId edit path param) plus the attribute set so the
// edit UI renders fields dynamically.
export class CommittedServicesResultDto {
  @ApiProperty({ example: 'uuid' })
  documentId!: string;

  @ApiProperty({ type: 'array', items: { type: 'object' } })
  services!: ReviewService[];

  @ApiProperty({ type: AttributeSetDto, nullable: true })
  attributeSet!: AttributeSetDto | null;
}
