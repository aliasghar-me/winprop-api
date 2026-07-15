import { ApiProperty } from '@nestjs/swagger';

export class ClaimTrialResultDto {
  @ApiProperty() accessToken: string;
  // True when the account was freshly provisioned (no real password yet), so the
  // frontend routes to the onboarding "set your password" step.
  @ApiProperty() needsOnboarding: boolean;
}
