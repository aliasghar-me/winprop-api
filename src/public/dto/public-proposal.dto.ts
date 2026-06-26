import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PublicBrandDto {
  @ApiProperty() agencyName: string;
  @ApiPropertyOptional({ nullable: true }) logoUrl?: string | null;
  @ApiProperty() brandColor: string;
  @ApiProperty() brandShort: string;
}

export class PublicProposalDto {
  @ApiProperty() title: string;
  @ApiProperty({ type: 'object', additionalProperties: true }) contentJson: Record<string, unknown>;
  @ApiProperty({ format: 'date-time' }) updatedAt: Date;
  @ApiPropertyOptional({ type: PublicBrandDto, nullable: true }) brand?: PublicBrandDto | null;
}
