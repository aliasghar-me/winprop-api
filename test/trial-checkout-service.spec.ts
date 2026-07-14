import { TrialCheckoutService } from '../src/auth/trial-checkout.service';
import { AppException } from '../src/common/errors/app-exception';

// Unit-only: fake Stripe + fake Prisma + fake AuthService/CryptoService (same style
// as the billing service unit specs). No network, no DB.

const crypto: any = { hmac: (v: string) => `hmac(${v})` };

function makeAuth(over: any = {}) {
  return {
    provisionAccount: jest.fn().mockResolvedValue({ user: { id: 'u1' }, org: { id: 'o1' }, membership: { role: 'owner' } }),
    issueTokens: jest.fn().mockResolvedValue({ accessToken: 'access.jwt', refreshToken: 'refresh.jwt' }),
    ...over,
  } as any;
}

function makePrisma(over: any = {}) {
  return {
    user: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn().mockReturnValue('user-op') },
    org: { update: jest.fn().mockReturnValue('org-op') },
    subscription: { upsert: jest.fn().mockReturnValue('sub-op') },
    $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
    ...over,
  } as any;
}

// A "complete" checkout session with expanded customer + subscription.
const completeSession = (over: any = {}) => ({
  id: 'cs_1',
  status: 'complete',
  customer_details: { email: 'buyer@x.com' },
  customer: { id: 'cus_1', email: 'buyer@x.com' },
  subscription: {
    id: 'sub_1',
    status: 'trialing',
    current_period_end: 1_800_000_000,
    trial_end: 1_700_000_000,
    items: { data: [{ price: { id: 'price_starter' } }] },
  },
  ...over,
});

describe('TrialCheckoutService', () => {
  const prevEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...prevEnv };
    jest.clearAllMocks();
  });

  describe('createCheckoutSession', () => {
    it('throws 503 BILLING_NOT_CONFIGURED when STRIPE_PRICE_STARTER is unset', async () => {
      delete process.env.STRIPE_PRICE_STARTER;
      const svc = new TrialCheckoutService({} as any, makePrisma(), crypto, makeAuth());
      await expect(svc.createCheckoutSession()).rejects.toMatchObject({ code: 'BILLING_NOT_CONFIGURED', getStatus: expect.any(Function) });
      await expect(svc.createCheckoutSession()).rejects.toBeInstanceOf(AppException);
    });

    it('builds a $0 trial session: trial_period_days=1, card required, NO payment_method_types, correct price/urls', async () => {
      process.env.STRIPE_PRICE_STARTER = 'price_env_starter';
      process.env.WEB_ORIGIN = 'https://app.test,https://other';
      const stripe: any = { checkout: { sessions: { create: jest.fn().mockResolvedValue({ url: 'https://checkout' }) } } };
      const svc = new TrialCheckoutService(stripe, makePrisma(), crypto, makeAuth());
      const r = await svc.createCheckoutSession();

      const arg = stripe.checkout.sessions.create.mock.calls[0][0];
      expect(arg.mode).toBe('subscription');
      expect(arg.line_items).toEqual([{ price: 'price_env_starter', quantity: 1 }]);
      expect(arg.subscription_data).toEqual({ trial_period_days: 1 });
      expect(arg.payment_method_collection).toBe('always');
      expect(arg.customer_creation).toBe('always');
      expect(arg.allow_promotion_codes).toBe(true);
      expect('payment_method_types' in arg).toBe(false); // dynamic payment methods
      expect(arg.success_url).toBe('https://app.test/welcome?session_id={CHECKOUT_SESSION_ID}');
      expect(arg.cancel_url).toBe('https://app.test/?trial=cancelled');
      expect(r).toEqual({ url: 'https://checkout' });
    });

    it('tolerates an unset WEB_ORIGIN', async () => {
      process.env.STRIPE_PRICE_STARTER = 'price_env_starter';
      delete process.env.WEB_ORIGIN;
      const stripe: any = { checkout: { sessions: { create: jest.fn().mockResolvedValue({ url: 'https://c' }) } } };
      const svc = new TrialCheckoutService(stripe, makePrisma(), crypto, makeAuth());
      await svc.createCheckoutSession();
      const arg = stripe.checkout.sessions.create.mock.calls[0][0];
      expect(arg.success_url).toBe('/welcome?session_id={CHECKOUT_SESSION_ID}');
    });
  });

  describe('claimTrial', () => {
    const stripeWith = (session: any, retrieve?: jest.Mock) => ({
      checkout: { sessions: { retrieve: retrieve ?? jest.fn().mockResolvedValue(session) } },
    });

    it('rejects (400) when the session cannot be retrieved', async () => {
      const stripe: any = stripeWith(null, jest.fn().mockRejectedValue(new Error('no such session')));
      const svc = new TrialCheckoutService(stripe, makePrisma(), crypto, makeAuth());
      await expect(svc.claimTrial('cs_missing')).rejects.toMatchObject({ code: 'VALIDATION', translationKey: 'errors.trialSessionInvalid' });
    });

    it('rejects (400) when Stripe returns a falsy session', async () => {
      const stripe: any = stripeWith(undefined);
      const svc = new TrialCheckoutService(stripe, makePrisma(), crypto, makeAuth());
      await expect(svc.claimTrial('cs_1')).rejects.toMatchObject({ code: 'VALIDATION' });
    });

    it('handles subscription/customer as bare string ids, email from the customer object, and trial_end fallback', async () => {
      delete process.env.STRIPE_PRICE_STARTER; // exercise the final '' price fallback
      const session = completeSession({
        subscription: 'sub_str', // bare string subscription id
        customer_details: undefined, // force email fallback to the expanded customer object
        customer: { id: 'cus_obj', email: 'via-customer@x.com' },
      });
      const prisma = makePrisma();
      const auth = makeAuth();
      // subscription is a string → no current_period_end/items; provide trial_end on... it's a string,
      // so the code cannot read trial_end from it → falls through to now(). Assert a Date is produced.
      const stripe: any = stripeWith(session);
      const svc = new TrialCheckoutService(stripe, prisma, crypto, auth);
      await svc.claimTrial('cs_1');
      expect(auth.provisionAccount).toHaveBeenCalledWith({ email: 'via-customer@x.com' });
      const subArg = prisma.subscription.upsert.mock.calls[0][0];
      expect(subArg.create.stripeSubId).toBe('sub_str');
      expect(subArg.create.stripePriceId).toBe('');
      expect(subArg.create.status).toBe('trialing');
      expect(subArg.create.currentPeriodEnd).toBeInstanceOf(Date);
    });

    it('uses subscription.trial_end when no current_period_end is present', async () => {
      const session = completeSession({
        subscription: { id: 'sub_te', status: 'trialing', trial_end: 1_650_000_000, items: { data: [{ price: { id: 'price_starter' } }] } },
      });
      const prisma = makePrisma();
      const svc = new TrialCheckoutService(stripeWith(session), prisma, crypto, makeAuth());
      await svc.claimTrial('cs_1');
      const subArg = prisma.subscription.upsert.mock.calls[0][0];
      expect(subArg.create.currentPeriodEnd).toEqual(new Date(1_650_000_000 * 1000));
    });

    it('rejects (400) when status !== complete', async () => {
      const stripe: any = stripeWith(completeSession({ status: 'open' }));
      const svc = new TrialCheckoutService(stripe, makePrisma(), crypto, makeAuth());
      await expect(svc.claimTrial('cs_1')).rejects.toMatchObject({ code: 'VALIDATION' });
    });

    it('rejects (400) when the subscription is not established', async () => {
      const stripe: any = stripeWith(completeSession({ subscription: null }));
      const svc = new TrialCheckoutService(stripe, makePrisma(), crypto, makeAuth());
      await expect(svc.claimTrial('cs_1')).rejects.toMatchObject({ code: 'VALIDATION' });
    });

    it('rejects (400) when no email can be extracted', async () => {
      const stripe: any = stripeWith(completeSession({ customer_details: {}, customer: { id: 'cus_1' } }));
      const svc = new TrialCheckoutService(stripe, makePrisma(), crypto, makeAuth());
      await expect(svc.claimTrial('cs_1')).rejects.toMatchObject({ code: 'VALIDATION' });
    });

    it('provisions a NEW account: verifies email, links Stripe customer, creates trialing subscription, issues tokens', async () => {
      const prisma = makePrisma();
      const auth = makeAuth();
      const stripe: any = stripeWith(completeSession());
      const svc = new TrialCheckoutService(stripe, prisma, crypto, auth);

      const r = await svc.claimTrial('cs_1');

      expect(auth.provisionAccount).toHaveBeenCalledWith({ email: 'buyer@x.com' });
      // emailVerifiedAt stamped on the new user
      expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ emailVerifiedAt: expect.any(Date) }) }));
      // Stripe customer linked to the org so the webhook can match it later
      expect(prisma.org.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ stripeCustomerId: 'cus_1', plan: 'starter', subStatus: 'trialing' }) }));
      const subArg = prisma.subscription.upsert.mock.calls[0][0];
      expect(subArg.where).toEqual({ orgId: 'o1' });
      expect(subArg.create).toMatchObject({ orgId: 'o1', stripeSubId: 'sub_1', stripePriceId: 'price_starter', status: 'trialing' });
      expect(subArg.create.currentPeriodEnd).toEqual(new Date(1_800_000_000 * 1000));
      expect(auth.issueTokens).toHaveBeenCalledWith('u1', 'o1', 'owner');
      expect(r).toEqual({ tokens: { accessToken: 'access.jwt', refreshToken: 'refresh.jwt' }, needsOnboarding: true });
    });

    it('is idempotent: an existing user logs in (owner org), no provisioning, no duplicate subscription', async () => {
      const prisma = makePrisma({
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'u-existing',
            passwordSetAt: null,
            memberships: [{ orgId: 'o-existing', role: 'owner' }],
          }),
          update: jest.fn(),
        },
      });
      const auth = makeAuth();
      const stripe: any = stripeWith(completeSession());
      const svc = new TrialCheckoutService(stripe, prisma, crypto, auth);

      const r = await svc.claimTrial('cs_1');

      expect(auth.provisionAccount).not.toHaveBeenCalled();
      expect(prisma.subscription.upsert).not.toHaveBeenCalled();
      expect(auth.issueTokens).toHaveBeenCalledWith('u-existing', 'o-existing', 'owner');
      // passwordSetAt null → still needs onboarding
      expect(r).toEqual({ tokens: { accessToken: 'access.jwt', refreshToken: 'refresh.jwt' }, needsOnboarding: true });
    });

    it('existing user with a password set → needsOnboarding false (falls back to first membership)', async () => {
      const prisma = makePrisma({
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'u2',
            passwordSetAt: new Date(),
            memberships: [{ orgId: 'o2', role: 'member' }], // no owner → first membership used
          }),
        },
      });
      const auth = makeAuth();
      const stripe: any = stripeWith(completeSession());
      const svc = new TrialCheckoutService(stripe, prisma, crypto, auth);
      const r = await svc.claimTrial('cs_1');
      expect(auth.issueTokens).toHaveBeenCalledWith('u2', 'o2', 'member');
      expect(r.needsOnboarding).toBe(false);
    });

    it('falls back through item-level period end and STRIPE_PRICE_STARTER price', async () => {
      process.env.STRIPE_PRICE_STARTER = 'price_env_starter';
      const session = completeSession({
        customer: 'cus_str', // customer as a bare string id
        subscription: {
          id: 'sub_2',
          status: 'trialing',
          items: { data: [{ current_period_end: 1_900_000_000 }] }, // no price.id, item-level period end
        },
      });
      const prisma = makePrisma();
      const auth = makeAuth();
      const stripe: any = stripeWith(session);
      const svc = new TrialCheckoutService(stripe, prisma, crypto, auth);
      await svc.claimTrial('cs_1');
      const subArg = prisma.subscription.upsert.mock.calls[0][0];
      expect(subArg.create.stripePriceId).toBe('price_env_starter');
      expect(subArg.create.currentPeriodEnd).toEqual(new Date(1_900_000_000 * 1000));
      expect(prisma.org.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ stripeCustomerId: 'cus_str' }) }));
    });
  });
});
