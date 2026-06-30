import { IsIn } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import { TONES, type ToneName } from '../../llm/prompt.builder';

export class AdjustToneDto {
  @IsIn(TONES as unknown as string[], { message: i18nValidationMessage('validation.isIn') })
  tone: ToneName;
}
