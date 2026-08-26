import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

// Input to POST /files/extract-metadata. Document type is taken from each file
// (set at upload), so only file ids are supplied here.
export class ExtractDocumentsDto {
  @ApiProperty({
    type: [String],
    description: 'Ids of uploaded files to extract metadata from.',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  fileIds!: string[];
}
