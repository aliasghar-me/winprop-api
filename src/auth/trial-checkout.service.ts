import { Inject, Injectable } from '@nestjs/common';
import type Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { STRIPE_CLIENT } from '../billing/stripe.token';
import { AppException } from '../common/errors/app-exception';
import { AuthService } from './auth.service';

// Card-first $0 free-trial flow. An anonymous visitor starts a Stripe Checkout
// (card captured, 1-day trial → Starter), and on return we verify the session,
// auto-provision a tenant + auto-login (idempotently). Kept out of BillingService
// to avoid an Auth↔Billing module cycle: it is provided by AuthModule (which imports
// BillingModule for STRIPE_CLIENT) so it can reuse AuthService.provisionAccount/issueTokens.
@Injectable()
export class TrialCheckoutService {
  constructor(
    @Inject(STRIPE_CLIENT) private stripe: Stripe.Stripe,
    private prisma: PrismaService,
    private crypto: CryptoService,
    private auth: AuthService,
  ) {}

  private webOrigin(): string {
    return process.env.WEB_ORIGIN?.split(',')[0] ?? '';
  }

  // PUBLIC (no auth, no org yet): create the $0 trial checkout session. The card is
  // collected today but not charged; Stripe starts a 1-day trial, then bills Starter.
  async createCheckoutSession() {
    const price = process.env.STRIPE_PRICE_STARTER;
    // Clean 503 (config error) rather than an opaque 500 if the price isn't wired.
    if (!price) throw new AppException(503, 'BILLING_NOT_CONFIGURED', 'errors.billingNotConfigured');

    const webOrigin = this.webOrigin();
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      subscription_data: { trial_period_days: 1 },
      payment_method_collection: 'always', // require a card even though today is $0
      customer_creation: 'always',
      allow_promotion_codes: true,
      // NB: never pass `payment_method_types` — omitting it enables dynamic payment
      // methods (Stripe best practice; configured from the Dashboard).
      success_url: `${webOrigin}/welcome?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${webOrigin}/?trial=cancelled`,
    });
    return { url: session.url };
  }

  // PUBLIC: verify a completed checkout → provision + auto-login. Idempotent: calling
  // it twice with the same sessionId logs the same user in without creating a second
  // org/subscription.
  async claimTrial(sessionId: string) {
    let session: any;
    try {
      session = await this.stripe.checkout.sessions.retrieve(sessionId, { expand: ['customer', 'subscription'] });
    } catch {
      throw new AppException(400, 'VALIDATION', 'errors.trialSessionInvalid');
    }
    // The subscription/payment must be fully established before we hand out an account.
    if (!session || session.status !== 'complete') {
      throw new AppException(400, 'VALIDATION', 'errors.trialSessionInvalid');
    }

    const subscription = typeof session.subscription === 'object' ? session.subscription : null;
    const subscriptionId = subscription?.id ?? (typeof session.subscription === 'string' ? session.subscription : null);
    const stripeCustomerId = typeof session.customer === 'string' ? session.customer : (session.customer?.id ?? null);
    const email =
      session.customer_details?.email ??
      (typeof session.customer === 'object' ? session.customer?.email : null) ??
      null;
    if (!subscriptionId || !stripeCustomerId || !email) {
      throw new AppException(400, 'VALIDATION', 'errors.trialSessionInvalid');
    }

    const status = subscription?.status ?? 'trialing';
    const priceId = subscription?.items?.data?.[0]?.price?.id ?? process.env.STRIPE_PRICE_STARTER ?? '';
    // Stripe API shape: period end lives on the subscription (older shape) or the
    // subscription item (newer), with trial_end as a further fallback.
    const periodEndUnix =
      subscription?.current_period_end ??
      subscription?.items?.data?.[0]?.current_period_end ??
      subscription?.trial_end ??
      Math.floor(Date.now() / 1000);
    const currentPeriodEnd = new Date(periodEndUnix * 1000);

    // Idempotent branch. Use the same (un-normalized) email string for both the
    // lookup and provisioning so the blind-index hash matches on a repeat call.
    const existing = await this.prisma.user.findUnique({
      where: { emailHash: this.crypto.hmac(email) },
      include: { memberships: true },
    });

    if (existing) {
      const owner = existing.memberships.find((m: any) => m.role === 'owner') ?? existing.memberships[0];
      const tokens = await this.auth.issueTokens(existing.id, owner.orgId, owner.role);
      // Not "just created": onboarding is needed only until a real password is set.
      return { tokens, needsOnboarding: existing.passwordSetAt == null };
    }

    const { user, org, membership } = await this.auth.provisionAccount({ email });
    // They paid and Stripe verified the email, so mark it verified; link the Stripe
    // customer to the org so the existing customer.subscription.* webhook matches it
    // by stripeCustomerId; and record the trialing Subscription up front.
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } }),
      this.prisma.org.update({ where: { id: org.id }, data: { stripeCustomerId, plan: 'starter', subStatus: status } }),
      this.prisma.subscription.upsert({
        where: { orgId: org.id },
        create: { orgId: org.id, stripeSubId: subscriptionId, stripePriceId: priceId, status, currentPeriodEnd },
        update: { stripeSubId: subscriptionId, stripePriceId: priceId, status, currentPeriodEnd },
      }),
    ]);
    const tokens = await this.auth.issueTokens(user.id, org.id, membership.role);
    return { tokens, needsOnboarding: true };
  }
}
