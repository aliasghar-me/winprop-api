import { ApiProperty } from '@nestjs/swagger';
import { DocStatus, DocType } from '@prisma/client';

export class DocumentDto {
  @ApiProperty() id: string;
  @ApiProperty() jobId: string;
  @ApiProperty({ enum: DocType }) type: DocType;
  @ApiProperty() title: string;
  @ApiProperty({ type: 'object', additionalProperties: true }) contentJson: Record<string, unknown>;
  @ApiProperty() version: number;
  @ApiProperty({ enum: DocStatus }) status: DocStatus;
  @ApiProperty({ format: 'date-time' }) createdAt: Date;
}
