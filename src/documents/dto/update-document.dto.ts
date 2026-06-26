import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsObject, IsOptional, IsString } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import { DocStatus } from '@prisma/client';

export class UpdateDocumentDto {
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional() @IsObject({ message: i18nValidationMessage('validation.isObject') }) contentJson?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsString({ message: i18nValidationMessage('validation.isString') }) title?: string;
  @ApiPropertyOptional({ enum: DocStatus }) @IsOptional() @IsEnum(DocStatus, { message: i18nValidationMessage('validation.isEnum') }) status?: DocStatus;
}
