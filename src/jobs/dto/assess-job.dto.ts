import { IsString, MaxLength, MinLength } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';

const m = (k: string) => i18nValidationMessage(k);

// "Should I Apply?" — the pasted job posting text.
export class AssessJobDto {
  @IsString({ message: m('validation.isString') })
  @MinLength(1, { message: m('validation.minLength') })
  @MaxLength(10000, { message: m('validation.maxLength') })
  text: string;
}
