import { IsString, MaxLength } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';

export class VerifyEmailDto {
  @IsString({ message: i18nValidationMessage('validation.isString') })
  @MaxLength(200, { message: i18nValidationMessage('validation.maxLength') })
  token: string;
}
