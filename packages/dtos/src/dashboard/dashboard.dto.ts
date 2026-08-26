import { ApiProperty } from '@nestjs/swagger';

// The dashboard's four KPI cards + the upload-card status + metadata, aggregated
// live per request (GET /dashboard). Cards cover the last 30 days; trendPercent is the
// relative change vs the prior 30 days (null when that baseline window is empty).

export class OverchargesDto {
  @ApiProperty({ description: 'Σ(billed − expected) over lines billed above expected.' })
  amount!: number;

  @ApiProperty({ nullable: true, description: 'Change vs the previous period, or null.' })
  trendPercent!: number | null;

  @ApiProperty({ nullable: true, description: "Previous period's amount, or null." })
  previousAmount!: number | null;
}

export class VerificationDto {
  @ApiProperty({ description: 'Matched line items ÷ adjudicated, as a 0–100 percentage.' })
  percent!: number;

  @ApiProperty({ nullable: true, description: 'Change vs the previous period, or null.' })
  trendPercent!: number | null;

  @ApiProperty({ description: 'Line items matched (status = match).' })
  lineItemsVerified!: number;

  @ApiProperty({ description: 'Line items adjudicated (status not null).' })
  totalLineItems!: number;

  @ApiProperty({ description: 'Distinct documents contributing line items.' })
  invoiceCount!: number;
}

export class ExceptionsDto {
  @ApiProperty({ description: 'Line items flagged mismatch or needs_review.' })
  count!: number;

  @ApiProperty({ nullable: true, description: 'Change vs the previous period, or null.' })
  trendPercent!: number | null;
}

export class AvgFlagsDto {
  @ApiProperty({ description: 'Flagged (mismatch + needs_review) line items ÷ documents.' })
  value!: number;

  @ApiProperty({ nullable: true, description: 'Change vs the previous period, or null.' })
  trendPercent!: number | null;
}

// Drives the left-hand upload / quotation empty-state cards. Computed live (cheap
// counts) so it never lags behind vendor adds or uploads.
export class DashboardStatusDto {
  @ApiProperty({ description: 'The org has at least one vendor.' })
  hasVendors!: boolean;

  @ApiProperty({ description: 'The org has at least one source (quotation) document.' })
  hasQuotations!: boolean;

  @ApiProperty({ description: 'The org has at least one transaction document.' })
  hasTransactions!: boolean;
}

export class DashboardMetaDto {
  @ApiProperty({ description: 'When these metrics were computed (ISO).' })
  lastUpdated!: string;

  @ApiProperty({ example: 'last-30-days', description: 'The period the metrics cover.' })
  period!: string;
}

export class DashboardDto {
  @ApiProperty({ type: OverchargesDto })
  overcharges!: OverchargesDto;

  @ApiProperty({ type: VerificationDto })
  verification!: VerificationDto;

  @ApiProperty({ type: ExceptionsDto })
  exceptions!: ExceptionsDto;

  @ApiProperty({ type: AvgFlagsDto })
  averageFlagsPerFile!: AvgFlagsDto;

  @ApiProperty({ type: DashboardStatusDto })
  status!: DashboardStatusDto;

  @ApiProperty({ type: DashboardMetaDto })
  meta!: DashboardMetaDto;
}
