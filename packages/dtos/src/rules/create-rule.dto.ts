import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { RULE_CATEGORIES, type RuleCategory } from '@nom/shared';

export class CreateRuleDto {
  @ApiProperty({ description: 'Short rule title.' })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiProperty({
    enum: RULE_CATEGORIES,
    description: 'The pipeline phase this rule steers.',
  })
  @IsEnum(RULE_CATEGORIES)
  category!: RuleCategory;

  @ApiProperty({ description: 'The rule body — natural-language guardrail text.' })
  @IsString()
  @IsNotEmpty()
  content!: string;
}
