import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ProfileDto {
  @ApiProperty() id: string;
  @ApiProperty() orgId: string;
  @ApiProperty() agencyName: string;
  @ApiProperty({ type: [String] }) services: string[];
  @ApiProperty({ type: [String] }) skills: string[];
  @ApiProperty() priceMin: number;
  @ApiProperty() priceMax: number;
  @ApiProperty() tone: string;
  @ApiProperty() brandColor: string;
  @ApiProperty() brandShort: string;
  @ApiPropertyOptional({ nullable: true }) logoUrl?: string | null;
  @ApiPropertyOptional({ nullable: true }) website?: string | null;
  @ApiPropertyOptional({ nullable: true }) contactInfo?: string | null;
  @ApiProperty({ type: [String] }) portfolioLinks: string[];
  @ApiPropertyOptional({ nullable: true }) caseStudies?: unknown;
  @ApiPropertyOptional({ nullable: true }) testimonials?: unknown;
}
