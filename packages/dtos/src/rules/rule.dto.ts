import { ApiProperty } from '@nestjs/swagger';
import { RULE_CATEGORIES, type RuleCategory } from '@nom/shared';

// Response shape for a vendor rule. Rules live in Neo4j (no TypeORM entity to reuse).
export class RuleDto {
  @ApiProperty({ example: 'uuid' })
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ enum: RULE_CATEGORIES })
  category!: RuleCategory;

  @ApiProperty()
  content!: string;

  @ApiProperty({ example: '2026-07-07T00:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-07-07T00:00:00.000Z' })
  updatedAt!: string;
}
