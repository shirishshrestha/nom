import { DOCUMENT_TYPES, FILE_CATEGORIES, FileCategory, DocumentType } from '@nom/shared';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateFileDto {
  @ApiProperty({ description: 'Original file name.' })
  @IsString()
  name!: string;

  @ApiProperty({ description: 'S3 object key the file is/will be stored under.' })
  @IsString()
  storageKey!: string;

  @ApiProperty({ description: 'MIME type, e.g. application/pdf.' })
  @IsString()
  mimeType!: string;

  @ApiProperty({ type: Number, description: 'File size in bytes.' })
  @IsInt()
  @Min(0)
  sizeBytes!: number;

  @ApiProperty({
    enum: DOCUMENT_TYPES,
    description: 'Document type the file holds; metadata extraction reads this.',
  })
  @IsEnum(DOCUMENT_TYPES)
  documentType!: DocumentType;

  @ApiPropertyOptional({
    enum: FILE_CATEGORIES,
    description: 'File category (defaults to document).',
  })
  @IsEnum(FILE_CATEGORIES)
  @IsOptional()
  category: FileCategory = FILE_CATEGORIES.DOCUMENT;
}
