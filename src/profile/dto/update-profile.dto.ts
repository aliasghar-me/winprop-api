import { ArrayMaxSize, IsArray, IsHexColor, IsInt, IsOptional, IsString, IsUrl, Max, MaxLength, Min } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';

const m = (k: string) => i18nValidationMessage(k);
const PRICE_MAX = 100_000_000;

export class UpdateProfileDto {
  @IsOptional() @IsString({ message: m('validation.isString') }) @MaxLength(200, { message: m('validation.maxLength') }) agencyName?: string;
  @IsOptional() @IsArray({ message: m('validation.isArray') }) @ArrayMaxSize(50, { message: m('validation.arrayMaxSize') }) @IsString({ each: true, message: m('validation.isString') }) @MaxLength(120, { each: true, message: m('validation.maxLength') }) services?: string[];
  @IsOptional() @IsArray({ message: m('validation.isArray') }) @ArrayMaxSize(50, { message: m('validation.arrayMaxSize') }) @IsString({ each: true, message: m('validation.isString') }) @MaxLength(120, { each: true, message: m('validation.maxLength') }) skills?: string[];
  @IsOptional() @IsInt({ message: m('validation.isInt') }) @Min(0, { message: m('validation.min') }) @Max(PRICE_MAX, { message: m('validation.maxLength') }) priceMin?: number;
  @IsOptional() @IsInt({ message: m('validation.isInt') }) @Min(0, { message: m('validation.min') }) @Max(PRICE_MAX, { message: m('validation.maxLength') }) priceMax?: number;
  @IsOptional() @IsString({ message: m('validation.isString') }) @MaxLength(40, { message: m('validation.maxLength') }) tone?: string;
  @IsOptional() @IsHexColor({ message: m('validation.isHexColor') }) brandColor?: string;
  @IsOptional() @IsString({ message: m('validation.isString') }) @MaxLength(8, { message: m('validation.maxLength') }) brandShort?: string;

  @IsOptional() @IsUrl({ require_tld: false }, { message: m('validation.isUrl') }) @MaxLength(2048, { message: m('validation.maxLength') }) logoUrl?: string;
  @IsOptional() @IsUrl({ require_tld: false }, { message: m('validation.isUrl') }) @MaxLength(2048, { message: m('validation.maxLength') }) website?: string;
  @IsOptional() @IsString({ message: m('validation.isString') }) @MaxLength(500, { message: m('validation.maxLength') }) contactInfo?: string;
  @IsOptional() @IsArray({ message: m('validation.isArray') }) @ArrayMaxSize(50, { message: m('validation.arrayMaxSize') }) @IsUrl({ require_tld: false }, { each: true, message: m('validation.isUrl') }) @MaxLength(2048, { each: true, message: m('validation.maxLength') }) portfolioLinks?: string[];
  // Free-form arrays of objects; capped in count (per-item shape validated lightly).
  @IsOptional() @IsArray({ message: m('validation.isArray') }) @ArrayMaxSize(50, { message: m('validation.arrayMaxSize') }) caseStudies?: unknown[];
  @IsOptional() @IsArray({ message: m('validation.isArray') }) @ArrayMaxSize(50, { message: m('validation.arrayMaxSize') }) testimonials?: unknown[];
}
