import { ApiProperty } from '@nestjs/swagger';

export class TrialCheckoutResultDto {
  @ApiProperty({ type: String, nullable: true }) url: string | null;
}
