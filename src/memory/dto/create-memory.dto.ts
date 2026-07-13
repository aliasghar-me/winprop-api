import { IsBoolean, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';

const m = (k: string) => i18nValidationMessage(k);

export class CreateMemoryDto {
  @IsString({ message: m('validation.isString') })
  @MinLength(1, { message: m('validation.minLength') })
  @MaxLength(100, { message: m('validation.maxLength') })
  category: string;

  @IsString({ message: m('validation.isString') })
  @MinLength(1, { message: m('validation.minLength') })
  @MaxLength(200, { message: m('validation.maxLength') })
  key: string;

  @IsString({ message: m('validation.isString') })
  @MinLength(1, { message: m('validation.minLength') })
  @MaxLength(5000, { message: m('validation.maxLength') })
  value: string;

  @IsOptional() @IsBoolean({ message: m('validation.isBoolean') }) sensitive?: boolean;

  @IsOptional()
  @IsNumber({}, { message: m('validation.isNumber') })
  @Min(0, { message: m('validation.min') })
  @Max(1, { message: m('validation.max') })
  confidence?: number;
}
