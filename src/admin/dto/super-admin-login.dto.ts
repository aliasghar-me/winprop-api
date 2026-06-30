import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';

export class SuperAdminLoginDto {
  @ApiProperty() @IsEmail({}, { message: i18nValidationMessage('validation.isEmail') }) email: string;
  @ApiProperty() @IsString({ message: i18nValidationMessage('validation.isString') }) password: string;
  @ApiPropertyOptional({ description: 'TOTP code (required once MFA is enrolled)' })
  @IsOptional() @IsString({ message: i18nValidationMessage('validation.isString') })
  @MaxLength(10, { message: i18nValidationMessage('validation.maxLength') })
  totpCode?: string;
}

export class SuperAdminTokenDto {
  @ApiProperty() token: string;
}

export class ConfirmMfaDto {
  @ApiProperty() @IsString({ message: i18nValidationMessage('validation.isString') })
  @MaxLength(10, { message: i18nValidationMessage('validation.maxLength') })
  code: string;
}

export class MfaEnrollDto {
  @ApiProperty() secret: string;
  @ApiProperty() otpauthUrl: string;
}
