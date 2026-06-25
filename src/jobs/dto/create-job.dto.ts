import { IsOptional, IsString, MinLength } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
export class CreateJobDto {
  @IsString({ message: i18nValidationMessage('validation.isString') })
  @MinLength(1, { message: i18nValidationMessage('validation.minLength') })
  title: string;
  @IsOptional() @IsString({ message: i18nValidationMessage('validation.isString') }) company?: string;
}
