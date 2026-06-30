import { ApiProperty } from '@nestjs/swagger';

export class AnalyticsSummaryDto {
  @ApiProperty() total: number;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } }) byStatus: Record<string, number>;
  @ApiProperty() won: number;
  @ApiProperty() lost: number;
  @ApiProperty() sent: number;
  @ApiProperty({ nullable: true, description: 'won / (won + lost); null until a deal is decided' })
  winRate: number | null;
}
