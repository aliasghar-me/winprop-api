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
  @ApiPropertyOptional({ type: Object, nullable: true, description: 'AI Job-Intelligence analysis (null until generated).' })
  intelligenceJson?: Record<string, unknown> | null;
  @ApiPropertyOptional({ nullable: true, description: 'USD amount awarded when status=won.' }) wonAmountUsd?: number | null;
  @ApiPropertyOptional({ nullable: true, description: 'Why the deal was won or lost (seeds the learning loop).' }) outcomeReason?: string | null;
  @ApiPropertyOptional({ description: 'True when at least one proposal document has been generated for this job.' }) applied?: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt: Date;
}
