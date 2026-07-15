import { ApiProperty } from '@nestjs/swagger';

export class TrialRemainingDto {
  @ApiProperty({ description: 'Free "Should I Apply?" verdicts left before the signup wall.' })
  verdicts: number;

  @ApiProperty({ description: 'Free generated proposals left before the signup wall.' })
  proposals: number;
}

export class PublicAssessResultDto {
  // Job-Intelligence analysis (recommendation, fit, expectedRoiUsdPerHour, redFlags,
  // winProbability, clarificationQuestions, …). Free-form JSON from the LLM.
  @ApiProperty({ type: Object, additionalProperties: true })
  analysis: Record<string, unknown>;

  @ApiProperty({ type: TrialRemainingDto })
  remaining: TrialRemainingDto;
}

export class PublicProposalResultDto {
  // Generated proposal (summary, scope, timelineWeeks, priceUsd, closing). Free-form JSON.
  @ApiProperty({ type: Object, additionalProperties: true })
  proposal: Record<string, unknown>;

  @ApiProperty({ type: TrialRemainingDto })
  remaining: TrialRemainingDto;
}
