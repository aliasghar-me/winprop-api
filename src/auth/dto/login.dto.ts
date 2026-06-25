import { IsEmail, IsString } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';

export class LoginDto {
  @IsEmail({}, { message: i18nValidationMessage('validation.isEmail') }) email: string;
  @IsString({ message: i18nValidationMessage('validation.isString') }) password: string;
}
