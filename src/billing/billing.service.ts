import { Inject, Injectable } from '@nestjs/common';
import type Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { STRIPE_CLIENT } from './stripe.token';

const PRICE_ENV: Record<string, string> = {
  solo: 'STRIPE_PRICE_SOLO', pro: 'STRIPE_PRICE_PRO', agency: 'STRIPE_PRICE_AGENCY',
};

@Injectable()
export class BillingService {
  constructor(@Inject(STRIPE_CLIENT) private stripe: Stripe, private prisma: PrismaService) {}

  async createCheckout(orgId: string, plan: 'solo' | 'pro' | 'agency') {
    let org = await this.prisma.org.findUnique({ where: { id: orgId } });
    if (!org!.stripeCustomerId) {
      const customer = await this.stripe.customers.create({ metadata: { orgId } });
      org = await this.prisma.org.update({ where: { id: orgId }, data: { stripeCustomerId: customer.id } });
    }
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: org!.stripeCustomerId!,
      line_items: [{ price: process.env[PRICE_ENV[plan]]!, quantity: 1 }],
      success_url: `${process.env.WEB_ORIGIN}/jobs?billing=success`,
      cancel_url: `${process.env.WEB_ORIGIN}/jobs?billing=cancel`,
      metadata: { orgId },
    });
    return { url: session.url };
  }
}
