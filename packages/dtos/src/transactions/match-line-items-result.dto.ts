import { ApiProperty } from '@nestjs/swagger';

// Returned by POST /transaction/documents/:id/match-line-items. A count summary of
// how the document's billed lines were reconciled against the vendor's rate card —
// the per-line detail (incl. the audit trail) is read back via GET .../line-items.
export class MatchLineItemsResultDto {
  @ApiProperty({ example: 'uuid' })
  documentId!: string;

  @ApiProperty({
    example: 42,
    description: 'Lines linked to a canonical service (BILLED_AS).',
  })
  serviceMatchCount!: number;

  @ApiProperty({
    example: 6,
    description: 'Lines computed from sibling lines (REFERENCES).',
  })
  siblingRefCount!: number;

  @ApiProperty({
    example: 3,
    description: 'Lines with no confident canonical or sibling match.',
  })
  unmatchedCount!: number;
}
