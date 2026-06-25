import { IsIn } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
export class CheckoutDto {
  @IsIn(['solo', 'pro', 'agency'], { message: i18nValidationMessage('validation.isIn') }) plan: 'solo' | 'pro' | 'agency';
}
