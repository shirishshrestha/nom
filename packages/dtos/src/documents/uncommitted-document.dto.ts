import { ApiProperty } from '@nestjs/swagger';
import type {
  DocumentMetadata,
  DocumentStatus,
  ReviewService,
  StagedStatus,
} from '@nom/shared';
import { AttributeSetDto } from './attribute-set.dto';

// One element of GET /source/uncommitted. Document-centric: every not-yet-committed
// source doc for the vendor. The client drives the next action from `status`
// (extracted → validate, validated → stage, staged → review). `metadata` lets the
// client show the doc's fields / validation result; `services` is non-empty only
// once the doc is staged.
export class UncommittedDocumentDto {
  @ApiProperty({ example: 'uuid', description: 'Document id.' })
  documentId!: string;

  @ApiProperty({ example: 'uuid', description: 'Source file id.' })
  fileId!: string;

  @ApiProperty({ description: 'Original uploaded file name.' })
  fileName!: string;

  @ApiProperty({
    example: 'staged',
    description: 'Drives the next action (extracted→validate, validated→stage, staged→review).',
  })
  status!: DocumentStatus;

  // Effective-from date (ISO) — the review list is ordered oldest-first by this
  // (falling back to documentDate / upload time) so the user commits in order.
  @ApiProperty({
    nullable: true,
    example: '2026-03-01T00:00:00.000Z',
    description: 'Effective-from date (ISO); the review list is ordered oldest-first by it.',
  })
  effectiveFrom!: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: "The document's extracted fields and validation result.",
  })
  metadata!: DocumentMetadata;

  @ApiProperty({
    type: 'array',
    items: { type: 'object' },
    description: 'Staged service lines; non-empty only once the doc is staged.',
  })
  services!: ReviewService[];

  @ApiProperty({
    nullable: true,
    example: 'ready_to_commit',
    description:
      'Review status of the live staged row (staged | ready_to_commit); null before the doc is staged. Drives the ready/commit-all UI.',
  })
  reviewStatus!: StagedStatus | null;

  @ApiProperty({
    nullable: true,
    example: 'uuid',
    description:
      'The live staged row id; null before the doc is staged. commit-all batches by this, not documentId.',
  })
  stagedId!: string | null;
}

// GET /source/uncommitted response. The attribute set is vendor-scoped metadata
// (all the vendor's docs share one), embedded so the review UI renders fields
// dynamically without a second round-trip. `attributeSet` is null when the vendor
// has no source docs with a resolved set.
export class UncommittedDocumentsResultDto {
  @ApiProperty({
    type: [UncommittedDocumentDto],
    description: "The vendor's not-yet-committed documents, oldest-first.",
  })
  documents!: UncommittedDocumentDto[];

  @ApiProperty({
    type: AttributeSetDto,
    nullable: true,
    description: 'Shared attribute set for the review UI; null if none resolved.',
  })
  attributeSet!: AttributeSetDto | null;
}

// GET /source/uncommitted/latest response. The org's single most-recently-touched
// uncommitted source doc across all vendors, for resuming the review editor without
// a vendorId. `document`/`vendorId`/`attributeSet` are all null when the org has
// nothing uncommitted.
export class LatestUncommittedResultDto {
  @ApiProperty({
    type: UncommittedDocumentDto,
    nullable: true,
    description: "The org's most-recent uncommitted document; null if none.",
  })
  document!: UncommittedDocumentDto | null;

  @ApiProperty({
    nullable: true,
    example: 'uuid',
    description: 'The vendor the document belongs to; null if none.',
  })
  vendorId!: string | null;

  @ApiProperty({
    type: AttributeSetDto,
    nullable: true,
    description: 'Shared attribute set for the review UI; null if none resolved.',
  })
  attributeSet!: AttributeSetDto | null;
}
