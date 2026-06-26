import { IsEmail, IsEnum, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import { JobStatus } from '@prisma/client';

// All fields optional — partial update / pipeline status transition.
export class UpdateJobDto {
  @IsOptional() @IsString({ message: i18nValidationMessage('validation.isString') }) @MinLength(1, { message: i18nValidationMessage('validation.minLength') }) title?: string;
  @IsOptional() @IsString({ message: i18nValidationMessage('validation.isString') }) company?: string;
  @IsOptional() @IsString({ message: i18nValidationMessage('validation.isString') }) clientName?: string;
  @IsOptional() @IsEmail({}, { message: i18nValidationMessage('validation.isEmail') }) clientEmail?: string;
  @IsOptional() @IsString({ message: i18nValidationMessage('validation.isString') }) clientWebsite?: string;
  @IsOptional() @IsString({ message: i18nValidationMessage('validation.isString') }) projectDescription?: string;
  @IsOptional() @IsString({ message: i18nValidationMessage('validation.isString') }) requirements?: string;
  @IsOptional() @IsInt({ message: i18nValidationMessage('validation.isInt') }) @Min(0, { message: i18nValidationMessage('validation.min') }) budget?: number;
  @IsOptional() @IsString({ message: i18nValidationMessage('validation.isString') }) timeline?: string;
  @IsOptional() @IsEnum(JobStatus, { message: i18nValidationMessage('validation.isEnum') }) status?: JobStatus;
}
