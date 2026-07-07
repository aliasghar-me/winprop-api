import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { i18nValidationMessage } from 'nestjs-i18n';

const m = (k: string) => i18nValidationMessage(k);
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class PreviewRequestDto {
  @Transform(trim)
  @IsString({ message: m('validation.isString') })
  @MinLength(1, { message: m('validation.minLength') })
  @MaxLength(200, { message: m('validation.maxLength') })
  title: string;

  @Transform(trim)
  @IsString({ message: m('validation.isString') })
  @MinLength(1, { message: m('validation.minLength') })
  @MaxLength(5000, { message: m('validation.maxLength') })
  description: string;

  // Honeypot — hidden in the UI. Any non-empty value = a bot.
  @IsOptional()
  @IsString({ message: m('validation.isString') })
  @MaxLength(200, { message: m('validation.maxLength') })
  website?: string;
}
