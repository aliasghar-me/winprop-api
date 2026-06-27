import { Inject, Injectable, Logger } from '@nestjs/common';
import type Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { STRIPE_CLIENT } from './stripe.token';
import { AppException } from '../common/errors/app-exception';
import { PLAN_LIMITS, computePeriodStart } from '../documents/quota.util';
import type { CheckoutPlan } from './dto/checkout.dto';

const PRICE_ENV: Record<CheckoutPlan, string> = {
  starter: 'STRIPE_PRICE_STARTER', professional: 'STRIPE_PRICE_PROFESSIONAL', agency: 'STRIPE_PRICE_AGENCY',
};

const MAX_ATTEMPTS = 5;
const DRAIN_BATCH = 20;
// A row claimed into `processing` but not finished within this window is assumed
// abandoned by a crashed worker and becomes eligible for reclaim (H1).
const STUCK_AFTER_MS = Number(process.env.WEBHOOK_STUCK_AFTER_MS ?? 120_000);

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(@Inject(STRIPE_CLIENT) private stripe: Stripe.Stripe, private prisma: PrismaService) {}

  private async ensureCustomer(orgId: string) {
    let org = await this.prisma.org.findUnique({ where: { id: orgId } });
    if (!org) throw new AppException(404, 'NOT_FOUND', 'errors.orgNotFound');
    if (!org.stripeCustomerId) {
      const customer = await this.stripe.customers.create({ metadata: { orgId } });
      org = await this.prisma.org.update({ where: { id: orgId }, data: { stripeCustomerId: customer.id } });
    }
    return org;
  }

  async createCheckout(orgId: string, plan: CheckoutPlan) {
    const org = await this.ensureCustomer(orgId);
    const webOrigin = process.env.WEB_ORIGIN?.split(',')[0] ?? '';
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: org.stripeCustomerId!,
      line_items: [{ price: process.env[PRICE_ENV[plan]]!, quantity: 1 }],
      success_url: `${webOrigin}/billing?status=success`,
      cancel_url: `${webOrigin}/billing?status=cancel`,
      metadata: { orgId },
    });
    return { url: session.url };
  }

  // Stripe-hosted customer portal (manage/cancel/update payment).
  async createPortal(orgId: string) {
    const org = await this.prisma.org.findUnique({ where: { id: orgId } });
    if (!org?.stripeCustomerId) throw new AppException(400, 'VALIDATION', 'errors.noBillingAccount');
    const webOrigin = process.env.WEB_ORIGIN?.split(',')[0] ?? '';
    const session = await this.stripe.billingPortal.sessions.create({
      customer: org.stripeCustomerId,
      return_url: `${webOrigin}/billing`,
    });
    return { url: session.url };
  }

  // Current plan + usage for the billing page.
  async getStatus(orgId: string) {
    const org = await this.prisma.org.findUnique({ where: { id: orgId }, include: { subscription: true } });
    if (!org) throw new AppException(404, 'NOT_FOUND', 'errors.orgNotFound');
    const periodStart = computePeriodStart({ orgCreatedAt: org.createdAt, subscriptionPeriodEnd: org.subscription?.currentPeriodEnd });
    const used = await this.prisma.generationLog.count({ where: { orgId, createdAt: { gte: periodStart } } });
    return {
      plan: org.plan,
      subStatus: org.subStatus ?? null,
      used,
      limit: PLAN_LIMITS[org.plan] ?? 0,
      periodEnd: org.subscription?.currentPeriodEnd ?? null,
    };
  }

  private priceToPlan(priceId: string): CheckoutPlan | 'free' {
    if (priceId === process.env.STRIPE_PRICE_STARTER || priceId === 'price_starter') return 'starter';
    if (priceId === process.env.STRIPE_PRICE_PROFESSIONAL || priceId === 'price_professional') return 'professional';
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
      event = this.stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET!);
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
  // Eligible rows: never-started (pending), previously-failed under the retry cap,
  // or stuck in `processing` past STUCK_AFTER_MS (a worker that claimed then crashed).
  async drainPending(): Promise<number> {
    const stuckCutoff = new Date(Date.now() - STUCK_AFTER_MS);
    const due = await this.prisma.webhookEvent.findMany({
      where: {
        OR: [
          { status: 'pending' },
          { status: 'failed', attempts: { lt: MAX_ATTEMPTS } },
          { status: 'processing', attempts: { lt: MAX_ATTEMPTS }, claimedAt: { lt: stuckCutoff } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: DRAIN_BATCH,
    });

    let processed = 0;
    for (const row of due) {
      // Claim atomically. `attempts` is bumped HERE (not on completion) so a row that
      // keeps crashing mid-processing is still bounded by MAX_ATTEMPTS. The claimedAt
      // guard makes reclaim of a stuck row a single-winner race.
      const claim = await this.prisma.webhookEvent.updateMany({
        where: {
          id: row.id,
          attempts: { lt: MAX_ATTEMPTS },
          OR: [{ status: { in: ['pending', 'failed'] } }, { status: 'processing', claimedAt: { lt: stuckCutoff } }],
        },
        data: { status: 'processing', claimedAt: new Date(), attempts: { increment: 1 } },
      });
      if (claim.count === 0) continue; // another worker took it (or it hit the cap)

      try {
        await this.processEvent(row.payload as any);
        await this.prisma.webhookEvent.update({
          where: { id: row.id },
          data: { status: 'done', processedAt: new Date(), lastError: null },
        });
        processed++;
      } catch (e: any) {
        const attempts = row.attempts + 1; // reflects the increment applied at claim time
        await this.prisma.webhookEvent.update({
          where: { id: row.id },
          data: { status: 'failed', lastError: String(e?.message ?? e).slice(0, 500) },
        });
        if (attempts >= MAX_ATTEMPTS) {
          // Dead-letter: exhausted retries. The row stays `status=failed` as a queryable
          // DLQ; surface it loudly so it can be investigated/replayed manually.
          this.logger.error(`webhook ${row.id} DEAD-LETTERED after ${attempts} attempts: ${e?.message ?? e}`);
        } else {
          this.logger.error(`webhook ${row.id} failed (attempt ${attempts}/${MAX_ATTEMPTS}): ${e?.message ?? e}`);
        }
      }
    }
    return processed;
  }

  // The business effect of an event. Writes the ProcessedEvent marker in the same
  // transaction as the data change so "processed" and the data can't diverge.
  private async processEvent(event: any) {
    if (['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'].includes(event.type)) {
      const sub: any = event.data.object;
      // Bind to the org by the Stripe CUSTOMER (which we set on our own Org row),
      // NOT by attacker-controllable event metadata. Metadata is only a fallback for
      // the very first event before stripeCustomerId is linked, and only when it
      // resolves to an org with no customer yet — never to override an existing mapping.
      const byCustomer = await this.prisma.org.findFirst({ where: { stripeCustomerId: sub.customer } });
      let orgId = byCustomer?.id;
      if (!orgId && sub.metadata?.orgId) {
        const claimed = await this.prisma.org.findFirst({ where: { id: sub.metadata.orgId, stripeCustomerId: null } });
        orgId = claimed?.id;
      }
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
