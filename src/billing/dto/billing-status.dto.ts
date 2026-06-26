import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Plan } from '@prisma/client';

export class BillingStatusDto {
  @ApiProperty({ enum: Plan }) plan: Plan;
  @ApiPropertyOptional({ nullable: true }) subStatus?: string | null;
  @ApiProperty() used: number;
  @ApiProperty() limit: number;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) periodEnd?: Date | null;
}
