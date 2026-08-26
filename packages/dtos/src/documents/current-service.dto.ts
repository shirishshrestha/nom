import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SERVICE_MODELS } from '@nom/shared';
import type { ServiceModel } from '@nom/shared';
import { AttributeSetDto } from './attribute-set.dto';

// One element of GET /vendors/:id/services — a current (non-amended)
// service the vendor offers, read from the graph. canonicalName/Description are the
// AI-derived concept grouping; attributes is the per attribute-set rate bag.
export class CurrentServiceDto {
  @ApiProperty({ example: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'local_haulage' })
  canonicalName!: string;

  @ApiProperty({ nullable: true })
  canonicalDescription!: string | null;

  @ApiProperty({ nullable: true })
  category!: string | null;

  @ApiProperty()
  title!: string;

  @ApiProperty({ nullable: true, example: '20ft' })
  tier!: string | null;

  @ApiProperty({
    nullable: true,
    example: '20ft',
    description: 'Normalized band key; tiers of one concept share canonicalName.',
  })
  tierSlug!: string | null;

  @ApiProperty()
  pricingContext!: string;

  @ApiProperty({
    enum: Object.values(SERVICE_MODELS),
    example: 'Tiered',
    description: 'Derived pricing model for this service’s canonical group.',
  })
  model!: ServiceModel;

  @ApiProperty({ type: 'object', additionalProperties: true })
  attributes!: Record<string, string | number | null>;

  @ApiProperty({ nullable: true })
  validFrom!: string | null;

  @ApiProperty({ nullable: true })
  validTo!: string | null;
}

// One element of GET /vendors/:id/services — a canonical concept with its child
// current-service (tier) lines. The list is paginated over these groups.
export class CanonicalServiceGroupDto {
  @ApiProperty({ example: 'local_haulage' })
  canonicalName!: string;

  @ApiProperty({ nullable: true })
  canonicalDescription!: string | null;

  @ApiProperty({ nullable: true })
  category!: string | null;

  @ApiProperty({ type: [CurrentServiceDto] })
  services!: CurrentServiceDto[];
}

// Pagination + filter query for GET /vendors/:id/services — paginates over canonical
// groups, optionally restricted to one quotation file and/or one pricing model.
export class ListCurrentServicesQueryDto {
  @ApiProperty({
    type: Number,
    required: false,
    minimum: 1,
    maximum: 100,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @ApiProperty({ type: Number, required: false, minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset = 0;

  @ApiProperty({
    required: false,
    description: 'Restrict to services extracted from this quotation file.',
  })
  @IsOptional()
  @IsUUID()
  fileId?: string;

  @ApiProperty({
    required: false,
    enum: Object.values(SERVICE_MODELS),
    description: 'Restrict to services of this pricing model.',
  })
  @IsOptional()
  @IsIn(Object.values(SERVICE_MODELS))
  model?: ServiceModel;

  @ApiProperty({
    required: false,
    description:
      'Case-insensitive substring filter over each canonical group ' +
      '(name/description/category and its service titles/tiers).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;
}

// One quotation file a vendor's services were extracted from — for the file-selection
// filter dropdown.
export class QuotationFileDto {
  @ApiProperty({ example: 'uuid', description: 'File id (use as ?fileId filter).' })
  fileId!: string;

  @ApiProperty({ example: 'Jurong Port Quotation.pdf' })
  fileName!: string;

  @ApiProperty({
    example: '2026-01-15T00:00:00.000Z',
    description: 'Upload timestamp (ISO).',
  })
  uploadDate!: string;
}

// GET /vendors/:id/services response — services grouped by canonical, paginated over
// the groups (`total` = total canonical groups). The attribute set is vendor-scoped
// metadata (all services share one set), embedded so the frontend renders columns
// without a second round-trip. `attributeSet` is null when the vendor has no committed
// services.
export class CurrentServicesResultDto {
  @ApiProperty({ type: [CanonicalServiceGroupDto] })
  groupedServices!: CanonicalServiceGroupDto[];

  @ApiProperty({ type: AttributeSetDto, nullable: true })
  attributeSet!: AttributeSetDto | null;

  @ApiProperty({
    type: [QuotationFileDto],
    description: "All quotation files uploaded for the vendor (for file selection).",
  })
  files!: QuotationFileDto[];

  @ApiProperty({ description: 'Number of quotation files for the vendor.' })
  fileCount!: number;

  @ApiProperty({ description: 'Total canonical groups (after filters).' })
  total!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  offset!: number;
}
