import { IsArray, IsHexColor, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';

export class UpdateProfileDto {
  @IsOptional() @IsString({ message: i18nValidationMessage('validation.isString') }) agencyName?: string;
  @IsOptional() @IsArray({ message: i18nValidationMessage('validation.isArray') }) @IsString({ each: true, message: i18nValidationMessage('validation.isString') }) services?: string[];
  @IsOptional() @IsArray({ message: i18nValidationMessage('validation.isArray') }) @IsString({ each: true, message: i18nValidationMessage('validation.isString') }) skills?: string[];
  @IsOptional() @IsInt({ message: i18nValidationMessage('validation.isInt') }) @Min(0, { message: i18nValidationMessage('validation.min') }) priceMin?: number;
  @IsOptional() @IsInt({ message: i18nValidationMessage('validation.isInt') }) @Min(0, { message: i18nValidationMessage('validation.min') }) priceMax?: number;
  @IsOptional() @IsString({ message: i18nValidationMessage('validation.isString') }) tone?: string;
  @IsOptional() @IsHexColor({ message: i18nValidationMessage('validation.isHexColor') }) brandColor?: string;
  @IsOptional() @IsString({ message: i18nValidationMessage('validation.isString') }) brandShort?: string;

  // Rich brand + credibility data.
  @IsOptional() @IsString({ message: i18nValidationMessage('validation.isString') }) logoUrl?: string;
  @IsOptional() @IsString({ message: i18nValidationMessage('validation.isString') }) website?: string;
  @IsOptional() @IsString({ message: i18nValidationMessage('validation.isString') }) contactInfo?: string;
  @IsOptional() @IsArray({ message: i18nValidationMessage('validation.isArray') }) @IsString({ each: true, message: i18nValidationMessage('validation.isString') }) portfolioLinks?: string[];
  // Free-form arrays of objects ([{title,summary,url?}] / [{author,quote,company?}]).
  @IsOptional() @IsArray({ message: i18nValidationMessage('validation.isArray') }) caseStudies?: unknown[];
  @IsOptional() @IsArray({ message: i18nValidationMessage('validation.isArray') }) testimonials?: unknown[];
}
