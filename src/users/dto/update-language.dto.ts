import { IsIn } from 'class-validator';

export const SUPPORTED_LANGUAGES = ['en', 'ur', 'ar', 'fr', 'es', 'hi', 'pt', 'bn', 'ru', 'zh'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export class UpdateLanguageDto {
  @IsIn(SUPPORTED_LANGUAGES, { message: `language must be one of: ${SUPPORTED_LANGUAGES.join(', ')}` })
  language!: SupportedLanguage;
}
