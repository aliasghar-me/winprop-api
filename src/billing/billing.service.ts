import { Inject, Injectable } from '@nestjs/common';
import type Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { STRIPE_CLIENT } from './stripe.token';
import { AppException } from '../common/errors/app-exception';

const PRICE_ENV: Record<string, string> = {
  solo: 'STRIPE_PRICE_SOLO', pro: 'STRIPE_PRICE_PRO', agency: 'STRIPE_PRICE_AGENCY',
};

@Injectable()
export class BillingService {
  constructor(@Inject(STRIPE_CLIENT) private stripe: Stripe.Stripe, private prisma: PrismaService) {}

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

  private priceToPlan(priceId: string): 'solo' | 'pro' | 'agency' | 'free' {
    if (priceId === process.env.STRIPE_PRICE_SOLO || priceId === 'price_solo') return 'solo';
    if (priceId === process.env.STRIPE_PRICE_PRO || priceId === 'price_pro') return 'pro';
    if (priceId === process.env.STRIPE_PRICE_AGENCY || priceId === 'price_agency') return 'agency';
    return 'free';
  }

  async handleEvent(rawBody: Buffer | string, signature: string) {
    let event: any;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET || 'whsec_dummy');
    } catch (e: any) {
      throw new AppException(400, 'VALIDATION', 'errors.invalidWebhookSignature');
    }
    // idempotency: store-and-skip. If already processed, do NOTHING.
    const seen = await this.prisma.processedEvent.findUnique({ where: { id: event.id } }).catch(() => null);
    if (seen) return { received: true };

    if (['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'].includes(event.type)) {
      const sub: any = event.data.object;
      const orgId = sub.metadata?.orgId
        ?? (await this.prisma.org.findFirst({ where: { stripeCustomerId: sub.customer } }))?.id;
      if (orgId) {
        const priceId = sub.items?.data?.[0]?.price?.id ?? '';
        const plan = event.type === 'customer.subscription.deleted' ? 'free' : this.priceToPlan(priceId);
        const periodEnd = new Date((sub.current_period_end ?? Math.floor(Date.now() / 1000)) * 1000);
        await this.prisma.$transaction([
          this.prisma.subscription.upsert({
            where: { orgId },
            create: { orgId, stripeSubId: sub.id, stripePriceId: priceId, status: sub.status, currentPeriodEnd: periodEnd },
            update: { stripeSubId: sub.id, stripePriceId: priceId, status: sub.status, currentPeriodEnd: periodEnd },
          }),
          this.prisma.org.update({ where: { id: orgId }, data: { plan, subStatus: sub.status } }),
        ]);
      }
    }
    await this.prisma.processedEvent.create({ data: { id: event.id } });
    return { received: true };
  }
}
