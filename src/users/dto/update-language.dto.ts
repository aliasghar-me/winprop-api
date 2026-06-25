import { IsIn } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';

export const SUPPORTED_LANGUAGES = ['en', 'ur', 'ar', 'fr', 'es', 'hi', 'pt', 'bn', 'ru', 'zh'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export class UpdateLanguageDto {
  @IsIn(SUPPORTED_LANGUAGES, { message: i18nValidationMessage('validation.isIn') })
  language!: SupportedLanguage;
}
