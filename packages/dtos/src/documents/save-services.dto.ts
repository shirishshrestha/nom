import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// One reviewed service edit. Reviewers may change attribute VALUES plus the
// concept-bearing `title` / `pricingContext`; everything else (tier, internal
// canonical fields) is taken server-side from the staging snapshot and never
// trusted from the client. Editing title/pricingContext re-resolves the canonical
// name at save (see SourceService.saveServices).
export class SaveServiceItemDto {
  @ApiProperty({ example: 'uuid', description: 'Staged service line id.' })
  @IsUUID('4')
  id!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Reviewed attribute values, keyed by attribute key.',
  })
  @IsObject()
  attributes!: Record<string, string | number | null>;

  @ApiProperty({
    required: false,
    description: 'Edited service title; re-resolves the canonical name at save.',
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

export class SaveServicesDto {
  @ApiProperty({
    type: [SaveServiceItemDto],
    description: 'The reviewed service lines to commit.',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SaveServiceItemDto)
  services!: SaveServiceItemDto[];

  @ApiProperty({
    required: false,
    type: [String],
    description:
      'Ids of staged service lines the reviewer removed; excluded from the committed snapshot.',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  deletedServiceIds?: string[];
}
