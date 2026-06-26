import { IsIn } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';

// Self-serve checkout tiers (enterprise is custom/sales-led — not here).
export const CHECKOUT_PLANS = ['starter', 'professional', 'agency'] as const;
export type CheckoutPlan = (typeof CHECKOUT_PLANS)[number];

export class CheckoutDto {
  @IsIn(CHECKOUT_PLANS, { message: i18nValidationMessage('validation.isIn') }) plan: CheckoutPlan;
}
