import { IsEmail, IsEnum, IsInt, IsOptional, IsString, IsUrl, Max, MaxLength, Min, MinLength } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import { JobStatus } from '@prisma/client';

const m = (k: string) => i18nValidationMessage(k);

// All fields optional — partial update / pipeline status transition.
export class UpdateJobDto {
  @IsOptional() @IsString({ message: m('validation.isString') }) @MinLength(1, { message: m('validation.minLength') }) @MaxLength(200, { message: m('validation.maxLength') }) title?: string;
  @IsOptional() @IsString({ message: m('validation.isString') }) @MaxLength(200, { message: m('validation.maxLength') }) company?: string;
  @IsOptional() @IsString({ message: m('validation.isString') }) @MaxLength(200, { message: m('validation.maxLength') }) clientName?: string;
  @IsOptional() @IsEmail({}, { message: m('validation.isEmail') }) @MaxLength(320, { message: m('validation.maxLength') }) clientEmail?: string;
  @IsOptional() @IsUrl({ require_tld: false }, { message: m('validation.isUrl') }) @MaxLength(2048, { message: m('validation.maxLength') }) clientWebsite?: string;
  @IsOptional() @IsString({ message: m('validation.isString') }) @MaxLength(5000, { message: m('validation.maxLength') }) projectDescription?: string;
  @IsOptional() @IsString({ message: m('validation.isString') }) @MaxLength(5000, { message: m('validation.maxLength') }) requirements?: string;
  @IsOptional() @IsInt({ message: m('validation.isInt') }) @Min(0, { message: m('validation.min') }) @Max(1_000_000_000, { message: m('validation.maxLength') }) budget?: number;
  @IsOptional() @IsString({ message: m('validation.isString') }) @MaxLength(120, { message: m('validation.maxLength') }) timeline?: string;
  @IsOptional() @IsEnum(JobStatus, { message: m('validation.isEnum') }) status?: JobStatus;
}
