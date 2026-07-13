import { ApiProperty } from '@nestjs/swagger';

export class AnalyticsSummaryDto {
  @ApiProperty() total: number;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } }) byStatus: Record<string, number>;
  @ApiProperty() won: number;
  @ApiProperty() lost: number;
  @ApiProperty() sent: number;
  @ApiProperty({ description: 'proposals that reached the client (== sent)' }) applications: number;
  @ApiProperty({ description: 'jobs that have an AI analysis' }) assessed: number;
  @ApiProperty({ description: 'assessed jobs that produced a proposal (funnel: assessed → applied → won)' }) applied: number;
  @ApiProperty({ description: '"avoid"-recommended jobs the user did NOT apply to (time saved)' }) avoidHeeded: number;
  @ApiProperty({ nullable: true, description: 'won / (won + lost); null until a deal is decided' })
  winRate: number | null;
  @ApiProperty({ description: 'headline KPI: sum of awarded amounts on won deals' }) revenueWonUsd: number;
  @ApiProperty({ nullable: true, description: 'revenueWon / applications; null with no applications' })
  revenuePerProposalUsd: number | null;
  @ApiProperty({ description: 'expected value of assessed-but-not-applied opportunities worth pursuing' })
  revenueOpportunityLostUsd: number;
}
