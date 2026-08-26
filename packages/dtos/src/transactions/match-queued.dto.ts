import { ApiProperty } from '@nestjs/swagger';
import { DOCUMENT_STATUSES, REVIEW_STATUSES } from '@nom/shared';
import type { DocumentStatus, ReviewStatus } from '@nom/shared';

// Returned by POST /transaction/documents/:id/match-line-items when background matching
// is enabled (TRANSACTION_MATCH_ASYNC): the job was enqueued and the document flipped to
// `matching`. Poll GET .../line-items (and the document status) for the result.
export class MatchQueuedDto {
  @ApiProperty({ example: 'uuid' })
  documentId!: string;

  @ApiProperty({ example: 'matching', description: 'Document status after enqueue.' })
  status!: string;
}

// Returned by GET /transaction/documents/:id/match-status — the poll endpoint the frontend
// hits after starting background matching, until status leaves `matching`.
export class MatchStatusDto {
  @ApiProperty({ example: 'uuid' })
  documentId!: string;

  @ApiProperty({
    enum: Object.values(DOCUMENT_STATUSES),
    example: 'matching',
    description:
      'matching = in flight; matched = done; committed = not matching / reverted on failure.',
  })
  status!: DocumentStatus;

  @ApiProperty({
    enum: Object.values(REVIEW_STATUSES),
    example: 'Pending',
    description:
      'Reviewer-facing status: Completed once marked reviewed, otherwise Pending.',
  })
  reviewStatus!: ReviewStatus;
}
