import { IsEmail, IsEnum, IsString, MinLength } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import { Profession } from '@prisma/client';

export class SignupDto {
  @IsEmail({}, { message: i18nValidationMessage('validation.isEmail') }) email: string;
  @MinLength(8, { message: i18nValidationMessage('validation.minLength') }) password: string;
  @IsString({ message: i18nValidationMessage('validation.isString') }) name: string;
  @IsString({ message: i18nValidationMessage('validation.isString') }) agencyName: string;
  @IsEnum(Profession, { message: i18nValidationMessage('validation.isEnum') }) profession: Profession;
}
