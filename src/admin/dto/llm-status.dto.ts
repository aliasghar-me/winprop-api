import { ApiProperty } from '@nestjs/swagger';
import { LlmVendor } from '@prisma/client';

export class LlmStatusDto {
  @ApiProperty() isSet: boolean;
  @ApiProperty({ enum: LlmVendor, nullable: true }) provider: LlmVendor | null;
  @ApiProperty({ type: String, nullable: true }) model: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) updatedAt: Date | null;
}
