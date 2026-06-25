import { IsEnum, IsString } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import { LlmVendor } from '@prisma/client';
export class SetLlmDto {
  @IsEnum(LlmVendor, { message: i18nValidationMessage('validation.isEnum') }) provider: LlmVendor;
  @IsString({ message: i18nValidationMessage('validation.isString') }) model: string;
  @IsString({ message: i18nValidationMessage('validation.isString') }) apiKey: string;
}
