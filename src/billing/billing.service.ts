import { Inject, Injectable, Logger } from '@nestjs/common';
import type Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { STRIPE_CLIENT } from './stripe.token';
import { AppException } from '../common/errors/app-exception';

const PRICE_ENV: Record<string, string> = {
  solo: 'STRIPE_PRICE_SOLO', pro: 'STRIPE_PRICE_PRO', agency: 'STRIPE_PRICE_AGENCY',
};

const MAX_ATTEMPTS = 5;
const DRAIN_BATCH = 20;

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

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

  // H1: synchronous-fast ACK. Verify the signature (cheap, in-process), persist
  // the event to the durable inbox, then return immediately. Actual work happens
  // in drainPending() off the request path so Stripe never waits on the DB write
  // of the subscription/org. Idempotent: a replay of the same event id is a no-op.
  async ingestEvent(rawBody: Buffer | string, signature: string) {
    let event: any;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET || 'whsec_dummy');
    } catch {
      throw new AppException(400, 'VALIDATION', 'errors.invalidWebhookSignature');
    }

    // Already fully processed (legacy marker) or already queued? Ack, do nothing.
    const processed = await this.prisma.processedEvent.findUnique({ where: { id: event.id } }).catch(() => null);
    if (processed) return { received: true };

    try {
      await this.prisma.webhookEvent.create({
        data: { id: event.id, type: event.type, payload: event as any },
      });
    } catch {
      // Unique-violation on a concurrent delivery of the same id — already queued. Fine.
      return { received: true };
    }

    // Fast path: kick a drain without blocking the response. The periodic/startup
    // drain in WebhookProcessor is the durability backstop if this process dies first.
    setImmediate(() => {
      this.drainPending().catch((e) => this.logger.error(`drain (fast path) failed: ${e?.message ?? e}`));
    });

    return { received: true };
  }

  // Drains queued webhook rows. Safe to run concurrently / repeatedly: each row is
  // claimed with a conditional status transition, so no event is processed twice.
  async drainPending(): Promise<number> {
    const due = await this.prisma.webhookEvent.findMany({
      where: { OR: [{ status: 'pending' }, { status: 'failed', attempts: { lt: MAX_ATTEMPTS } }] },
      orderBy: { createdAt: 'asc' },
      take: DRAIN_BATCH,
    });

    let processed = 0;
    for (const row of due) {
      // Claim: only the worker that flips pending/failed -> processing owns this row.
      const claim = await this.prisma.webhookEvent.updateMany({
        where: { id: row.id, status: { in: ['pending', 'failed'] } },
        data: { status: 'processing' },
      });
      if (claim.count === 0) continue; // another drain took it

      try {
        await this.processEvent(row.payload as any);
        await this.prisma.webhookEvent.update({
          where: { id: row.id },
          data: { status: 'done', processedAt: new Date(), lastError: null, attempts: { increment: 1 } },
        });
        processed++;
      } catch (e: any) {
        const attempts = row.attempts + 1;
        await this.prisma.webhookEvent.update({
          where: { id: row.id },
          data: { status: 'failed', attempts, lastError: String(e?.message ?? e).slice(0, 500) },
        });
        this.logger.error(`webhook ${row.id} failed (attempt ${attempts}/${MAX_ATTEMPTS}): ${e?.message ?? e}`);
      }
    }
    return processed;
  }

  // The business effect of an event. Writes the ProcessedEvent marker in the same
  // transaction as the data change so "processed" and the data can't diverge.
  private async processEvent(event: any) {
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
          this.prisma.processedEvent.upsert({ where: { id: event.id }, create: { id: event.id }, update: {} }),
        ]);
        return;
      }
    }
    // Events we don't act on are still marked processed so they don't re-drain forever.
    await this.prisma.processedEvent.upsert({ where: { id: event.id }, create: { id: event.id }, update: {} });
  }
}
