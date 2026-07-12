import { BillingService } from '../src/billing/billing.service';

// Unit-only: exercise the pure priceId -> plan mapping. All Stripe/DB-backed methods
// (createCheckout, ingestEvent, drainPending, processEvent) require real Stripe or the
// database and are covered by e2e specs instead.
describe('BillingService.priceToPlan', () => {
  const prevEnv = { ...process.env };
  let svc: BillingService;

  beforeAll(() => {
    process.env.STRIPE_PRICE_STARTER = 'price_env_starter';
    process.env.STRIPE_PRICE_PROFESSIONAL = 'price_env_pro';
    process.env.STRIPE_PRICE_AGENCY = 'price_env_agency';
    const stripe: any = {};
    const prisma: any = {};
    svc = new BillingService(stripe, prisma);
  });

  afterAll(() => {
    process.env.STRIPE_PRICE_STARTER = prevEnv.STRIPE_PRICE_STARTER;
    process.env.STRIPE_PRICE_PROFESSIONAL = prevEnv.STRIPE_PRICE_PROFESSIONAL;
    process.env.STRIPE_PRICE_AGENCY = prevEnv.STRIPE_PRICE_AGENCY;
  });

  const priceToPlan = (id: string) => (svc as any).priceToPlan(id) as string;

  it('maps configured env price ids to their plans', () => {
    expect(priceToPlan('price_env_starter')).toBe('starter');
    expect(priceToPlan('price_env_pro')).toBe('professional');
    expect(priceToPlan('price_env_agency')).toBe('agency');
  });

  it('maps the hardcoded test/fallback price ids', () => {
    expect(priceToPlan('price_starter')).toBe('starter');
    expect(priceToPlan('price_professional')).toBe('professional');
    expect(priceToPlan('price_agency')).toBe('agency');
  });

  it('falls back to free for an unknown price id', () => {
    expect(priceToPlan('price_unknown')).toBe('free');
    expect(priceToPlan('')).toBe('free');
  });
});
