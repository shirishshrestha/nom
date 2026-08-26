import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DOCUMENT_STATUSES, REVIEW_STATUSES } from '@nom/shared';
import type { DocumentMetadata, DocumentStatus, ReviewStatus } from '@nom/shared';

// One row in a document-centric listing (GET /source/documents,
// GET /transaction/documents). Shared by both document types; `metadata` carries
// the type-specific fields (e.g. a transaction's sectionTotals/total).
export class DocumentListItemDto {
  @ApiProperty({ example: 'uuid', description: 'Document id.' })
  documentId!: string;

  @ApiProperty({ example: 'uuid', description: 'Source file id.' })
  fileId!: string;

  @ApiProperty({ description: 'Original uploaded file name.' })
  fileName!: string;

  @ApiProperty({ example: 'validated', description: 'Document lifecycle status.' })
  status!: DocumentStatus;

  @ApiProperty({
    enum: Object.values(REVIEW_STATUSES),
    example: 'Pending',
    description:
      'Reviewer-facing status: Completed once marked reviewed, otherwise Pending.',
  })
  reviewStatus!: ReviewStatus;

  @ApiProperty({ nullable: true, example: 'uuid', description: 'Vendor id, or null.' })
  vendorId!: string | null;

  @ApiProperty({
    nullable: true,
    example: 'Acme Freight',
    description: "Vendor's display name, or null.",
  })
  vendorName!: string | null;

  @ApiProperty({
    type: [String],
    example: ['amount'],
    description:
      "The attribute-set's ordered amount keys (which attribute holds the billed total). [] for an unknown set.",
  })
  amountKeys!: string[];

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 245678,
    description: 'Source file size in bytes, or null if the file is missing.',
  })
  fileSizeBytes!: number | null;

  @ApiProperty({
    example: '2026-01-15T00:00:00.000Z',
    description: 'Document creation timestamp (ISO).',
  })
  createdAt!: string;

  @ApiProperty({
    example: '2026-01-15T00:00:00.000Z',
    description: 'Document last-update timestamp (ISO).',
  })
  updatedAt!: string;

  @ApiProperty({
    nullable: true,
    example: '2025-01-15T00:00:00.000Z',
    description: 'Effective-from date (ISO); list is ordered newest-first by it.',
  })
  effectiveFrom!: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: "The document's extracted metadata (includes transaction totals).",
  })
  metadata!: DocumentMetadata;
}

export class DocumentListDto {
  @ApiProperty({ type: [DocumentListItemDto] })
  documents!: DocumentListItemDto[];

  @ApiProperty({ description: 'Total matching documents, ignoring pagination.' })
  totalCount!: number;

  @ApiProperty({ description: 'Current page (1-based).' })
  page!: number;

  @ApiProperty({ description: 'Page size.' })
  limit!: number;
}

// Filters + offset pagination for GET /transaction/documents (the invoice list).
export class ListTransactionDocumentsQueryDto {
  @ApiProperty({ required: false, description: "Restrict to a single vendor's documents." })
  @IsOptional()
  @IsUUID()
  vendorId?: string;

  @ApiProperty({
    required: false,
    enum: Object.values(DOCUMENT_STATUSES),
    description: 'Filter by lifecycle status.',
  })
  @IsOptional()
  @IsIn(Object.values(DOCUMENT_STATUSES))
  status?: DocumentStatus;

  @ApiProperty({ required: false, description: 'Inclusive lower bound on effective-from date (ISO).' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiProperty({ required: false, description: 'Inclusive upper bound on effective-from date (ISO).' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiProperty({ type: Number, required: false, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

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
  limit: number = 20;
}

export class DiscardDocumentResultDto {
  @ApiProperty({ example: 'uuid', description: 'Discarded document id.' })
  documentId!: string;

  @ApiProperty({ example: 'discarded', description: 'Resulting status.' })
  status!: DocumentStatus;
}

// Result of marking / unmarking a transaction document review complete.
export class ReviewCompletionResultDto {
  @ApiProperty({ example: 'uuid', description: 'Document id.' })
  documentId!: string;

  @ApiProperty({ description: 'Whether the review is now marked complete.' })
  reviewCompleted!: boolean;

  @ApiProperty({
    enum: Object.values(REVIEW_STATUSES),
    example: 'Completed',
    description: 'Recomputed reviewer-facing status.',
  })
  reviewStatus!: ReviewStatus;
}
