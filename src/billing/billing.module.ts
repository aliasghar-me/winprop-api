import { Module } from '@nestjs/common';
import Stripe from 'stripe';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { WebhookProcessor } from './webhook.processor';
import { STRIPE_CLIENT } from './stripe.token';

export { STRIPE_CLIENT } from './stripe.token';

@Module({
  providers: [
    { provide: STRIPE_CLIENT, useFactory: () => new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_dummy') },
    BillingService,
    WebhookProcessor,
  ],
  controllers: [BillingController],
  exports: [STRIPE_CLIENT, BillingService],
})
export class BillingModule {}
