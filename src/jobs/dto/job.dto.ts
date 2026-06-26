import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { JobStatus } from '@prisma/client';

export class JobDto {
  @ApiProperty() id: string;
  @ApiProperty() orgId: string;
  @ApiProperty() title: string;
  @ApiProperty() company: string;
  @ApiPropertyOptional({ nullable: true }) clientName?: string | null;
  @ApiPropertyOptional({ nullable: true }) clientEmail?: string | null;
  @ApiPropertyOptional({ nullable: true }) clientWebsite?: string | null;
  @ApiPropertyOptional({ nullable: true }) projectDescription?: string | null;
  @ApiPropertyOptional({ nullable: true }) requirements?: string | null;
  @ApiPropertyOptional({ nullable: true }) budget?: number | null;
  @ApiPropertyOptional({ nullable: true }) timeline?: string | null;
  @ApiProperty({ enum: JobStatus }) status: JobStatus;
  @ApiProperty({ format: 'date-time' }) createdAt: Date;
}
