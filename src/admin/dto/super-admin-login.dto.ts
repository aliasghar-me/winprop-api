import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';

export class SuperAdminLoginDto {
  @ApiProperty() @IsEmail({}, { message: i18nValidationMessage('validation.isEmail') }) email: string;
  @ApiProperty() @IsString({ message: i18nValidationMessage('validation.isString') }) password: string;
}

export class SuperAdminTokenDto {
  @ApiProperty() token: string;
}
