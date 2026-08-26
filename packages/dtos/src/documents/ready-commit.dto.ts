import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';
import type { StagedStatus } from '@nom/shared';

// Returned by mark-ready / unmark-ready. The staged snapshot is NOT promoted to the
// graph — only the row's review status (and version, if edits were saved) changes.
export class ReviewStatusResultDto {
  @ApiProperty({ example: 'uuid' })
  documentId!: string;

  @ApiProperty({ type: Number, description: 'The live staged row version.' })
  version!: number;

  @ApiProperty({
    example: 'ready_to_commit',
    description: 'The staged row status after the change (staged | ready_to_commit).',
  })
  reviewStatus!: StagedStatus;
}

// POST /source/commit-all — commit a batch of reviewer-accepted staged rows. `stagedIds`
// are staged-row ids; only rows currently `ready_to_commit` for this vendor are committed.
export class CommitAllDto {
  @ApiProperty({ example: 'uuid', description: 'Vendor the staged rows belong to.' })
  @IsUUID('4')
  vendorId!: string;

  @ApiProperty({
    type: [String],
    description: 'Staged-row ids to commit; each must be ready_to_commit.',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  stagedIds!: string[];
}

// One committed staged row in a commit-all batch.
export class CommitAllItemDto {
  @ApiProperty({ example: 'uuid', description: 'Staged-row id.' })
  stagedId!: string;

  @ApiProperty({ example: 'uuid' })
  documentId!: string;

  @ApiProperty({ type: Number })
  version!: number;

  @ApiProperty({ type: Number })
  serviceCount!: number;

  @ApiProperty({ type: Number })
  canonicalCount!: number;
}

// One staged row that was NOT committed (not ready, wrong vendor, unknown id, or the
// commit itself threw). Per-row so one bad doc never aborts the whole batch.
export class CommitAllFailureDto {
  @ApiProperty({ example: 'uuid', description: 'Staged-row id.' })
  stagedId!: string;

  @ApiProperty({ description: 'Why this row was skipped or failed.' })
  reason!: string;
}

// POST /source/commit-all response.
export class CommitAllResultDto {
  @ApiProperty({ type: [CommitAllItemDto] })
  committed!: CommitAllItemDto[];

  @ApiProperty({ type: [CommitAllFailureDto] })
  failed!: CommitAllFailureDto[];
}
