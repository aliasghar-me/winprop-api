import { ApiProperty } from '@nestjs/swagger';
import { Plan, Profession } from '@prisma/client';

export class OrgSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: Profession }) profession: Profession;
  @ApiProperty({ enum: Plan }) plan: Plan;
}
