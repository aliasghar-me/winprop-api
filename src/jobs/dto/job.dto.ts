import { ApiProperty } from '@nestjs/swagger';
import { JobStatus } from '@prisma/client';

export class JobDto {
  @ApiProperty() id: string;
  @ApiProperty() orgId: string;
  @ApiProperty() title: string;
  @ApiProperty() company: string;
  @ApiProperty({ enum: JobStatus }) status: JobStatus;
  @ApiProperty({ format: 'date-time' }) createdAt: Date;
}
