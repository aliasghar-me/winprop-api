import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SkillReputationDto {
  @ApiProperty({ description: 'Skill name extracted from intelligenceJson.stack[]' })
  skill: string;

  @ApiProperty({ description: 'Total jobs touching this skill' })
  count: number;

  @ApiProperty({ description: 'Jobs with status won or lost' })
  decided: number;

  @ApiProperty({ description: 'Jobs with status won' })
  wins: number;

  @ApiProperty({ description: 'Jobs with status lost' })
  losses: number;

  @ApiPropertyOptional({
    nullable: true,
    description: 'wins / decided; null when decided === 0',
  })
  winRate: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Mean wonAmountUsd across won jobs; null if no won jobs',
  })
  avgWonUsd: number | null;

  @ApiProperty({ description: 'Sum of wonAmountUsd across won jobs' })
  revenueWonUsd: number;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Mean (updatedAt − createdAt) in days across decided jobs; null if none. ' +
      '// proxy: updatedAt — stand-in for a future decidedAt field',
  })
  avgCloseDays: number | null;
}

export class SkillReputationListDto {
  @ApiProperty({ type: [SkillReputationDto] })
  skills: SkillReputationDto[];

  @ApiProperty({
    description: 'Minimum sample size recommendation for reliable metrics',
    example: 3,
  })
  minSample: number;
}
