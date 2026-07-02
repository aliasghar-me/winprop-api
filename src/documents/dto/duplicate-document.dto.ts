import { IsOptional, IsString, MaxLength } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';

export class DuplicateDocumentDto {
  // Optional: clone into another job the caller owns; defaults to the same job.
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.isString') })
  @MaxLength(64, { message: i18nValidationMessage('validation.maxLength') })
  targetJobId?: string;
}
