import { IsEnum, IsObject, IsOptional, IsString } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import { DocStatus } from '@prisma/client';

export class UpdateDocumentDto {
  @IsOptional() @IsObject({ message: i18nValidationMessage('validation.isObject') }) contentJson?: Record<string, unknown>;
  @IsOptional() @IsString({ message: i18nValidationMessage('validation.isString') }) title?: string;
  @IsOptional() @IsEnum(DocStatus, { message: i18nValidationMessage('validation.isEnum') }) status?: DocStatus;
}
