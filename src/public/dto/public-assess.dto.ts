import { IsDefined, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { i18nValidationMessage } from 'nestjs-i18n';

const m = (k: string) => i18nValidationMessage(k);
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

// Client-side device signals used to identify an anonymous visitor for the free
// trial. Only `visitorId` is required; the rest refine the device fingerprint and
// are hashed server-side (never stored raw).
export class FingerprintSignalDto {
  @ApiProperty()
  @Transform(trim)
  @IsString({ message: m('validation.isString') })
  @IsNotEmpty({ message: m('validation.isNotEmpty') })
  @MaxLength(256, { message: m('validation.maxLength') })
  visitorId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString({ message: m('validation.isString') })
  @MaxLength(512, { message: m('validation.maxLength') })
  userAgent?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString({ message: m('validation.isString') })
  @MaxLength(128, { message: m('validation.maxLength') })
  timezone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString({ message: m('validation.isString') })
  @MaxLength(64, { message: m('validation.maxLength') })
  language?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString({ message: m('validation.isString') })
  @MaxLength(128, { message: m('validation.maxLength') })
  platform?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString({ message: m('validation.isString') })
  @MaxLength(2048, { message: m('validation.maxLength') })
  canvas?: string;
}

export class PublicAssessDto {
  @ApiProperty()
  @Transform(trim)
  @IsString({ message: m('validation.isString') })
  @MinLength(1, { message: m('validation.minLength') })
  @MaxLength(200, { message: m('validation.maxLength') })
  title: string;

  @ApiProperty()
  @Transform(trim)
  @IsString({ message: m('validation.isString') })
  @MinLength(1, { message: m('validation.minLength') })
  @MaxLength(5000, { message: m('validation.maxLength') })
  description: string;

  @ApiProperty({ type: FingerprintSignalDto })
  @IsDefined({ message: m('validation.isObject') })
  @IsObject({ message: m('validation.isObject') })
  @ValidateNested()
  @Type(() => FingerprintSignalDto)
  fingerprint: FingerprintSignalDto;

  // Honeypot — hidden in the UI. Any non-empty value = a bot.
  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: m('validation.isString') })
  @MaxLength(200, { message: m('validation.maxLength') })
  website?: string;
}
