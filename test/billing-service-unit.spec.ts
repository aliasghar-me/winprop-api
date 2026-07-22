import { BillingService } from '../src/billing/billing.service';

// Unit-only: drive the non-network branch logic of BillingService with fake
// Stripe + fake Prisma. No real Stripe round-trips, no database. Methods that
// only assemble a Stripe call (createCheckout/createPortal) are exercised with
// fakes that return canned session objects; ingestEvent/drainPending/processEvent
// branch decisions are covered with a fake inbox.

const makePrisma = (over: any = {}) => ({
  org: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  subscription: { upsert: jest.fn().mockReturnValue('sub-op') },
  processedEvent: { findUnique: jest.fn(), upsert: jest.fn().mockReturnValue('marker-op') },
  webhookEvent: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn(), update: jest.fn() },
  generationLog: { count: jest.fn() },
  $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
  ...over,
});

describe('BillingService (unit, fakes)', () => {
  const prevEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...prevEnv };
    jest.clearAllMocks();
  });

  describe('ensureCustomer / createCheckout', () => {
    it('throws NOT_FOUND when org missing', async () => {
      const prisma: any = makePrisma();
      prisma.org.findUnique.mockResolvedValue(null);
      const svc = new BillingService({} as any, prisma);
      await expect(svc.createCheckout('o1', 'starter' as any)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('creates a Stripe customer when org has none, then builds a checkout session', async () => {
      process.env.WEB_ORIGIN = 'https://app.test,https://other';
      process.env.STRIPE_PRICE_STARTER = 'price_env_starter';
      const prisma: any = makePrisma();
      prisma.org.findUnique.mockResolvedValue({ id: 'o1', stripeCustomerId: null });
      prisma.org.update.mockResolvedValue({ id: 'o1', stripeCustomerId: 'cus_new' });
      const stripe: any = {
        customers: { create: jest.fn().mockResolvedValue({ id: 'cus_new' }) },
        checkout: { sessions: { create: jest.fn().mockResolvedValue({ url: 'https://checkout' }) } },
      };
      const svc = new BillingService(stripe, prisma);
      const r = await svc.createCheckout('o1', 'starter' as any);
      expect(stripe.customers.create).toHaveBeenCalledWith({ metadata: { orgId: 'o1' } });
      expect(prisma.org.update).toHaveBeenCalled();
      // success/cancel urls take the first WEB_ORIGIN entry
      const arg = stripe.checkout.sessions.create.mock.calls[0][0];
      expect(arg.customer).toBe('cus_new');
      expect(arg.line_items[0].price).toBe('price_env_starter');
      expect(arg.success_url).toContain('https://app.test');
      expect(r).toEqual({ url: 'https://checkout' });
    });

    it('reuses an existing Stripe customer and tolerates unset WEB_ORIGIN', async () => {
      delete process.env.WEB_ORIGIN;
      const prisma: any = makePrisma();
      prisma.org.findUnique.mockResolvedValue({ id: 'o1', stripeCustomerId: 'cus_existing' });
      const stripe: any = {
        customers: { create: jest.fn() },
        checkout: { sessions: { create: jest.fn().mockResolvedValue({ url: 'https://c2' }) } },
      };
      const svc = new BillingService(stripe, prisma);
      const r = await svc.createCheckout('o1', 'agency' as any);
      expect(stripe.customers.create).not.toHaveBeenCalled();
      const arg = stripe.checkout.sessions.create.mock.calls[0][0];
      expect(arg.success_url).toBe('/billing?status=success');
      expect(r).toEqual({ url: 'https://c2' });
    });
  });

  describe('createPortal', () => {
    it('throws VALIDATION when org has no billing account', async () => {
      const prisma: any = makePrisma();
      prisma.org.findUnique.mockResolvedValue({ id: 'o1', stripeCustomerId: null });
      const svc = new BillingService({} as any, prisma);
      await expect(svc.createPortal('o1')).rejects.toMatchObject({ code: 'VALIDATION' });
    });

    it('throws VALIDATION when org row missing entirely', async () => {
      const prisma: any = makePrisma();
      prisma.org.findUnique.mockResolvedValue(null);
      const svc = new BillingService({} as any, prisma);
      await expect(svc.createPortal('o1')).rejects.toMatchObject({ code: 'VALIDATION' });
    });

    it('tolerates an unset WEB_ORIGIN when building the portal return url', async () => {
      delete process.env.WEB_ORIGIN;
      const prisma: any = makePrisma();
      prisma.org.findUnique.mockResolvedValue({ id: 'o1', stripeCustomerId: 'cus_1' });
      const stripe: any = { billingPortal: { sessions: { create: jest.fn().mockResolvedValue({ url: 'https://portal' }) } } };
      const svc = new BillingService(stripe, prisma);
      await svc.createPortal('o1');
      expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith({ customer: 'cus_1', return_url: '/billing' });
    });

    it('returns the portal session url when a customer exists', async () => {
      process.env.WEB_ORIGIN = 'https://app.test';
      const prisma: any = makePrisma();
      prisma.org.findUnique.mockResolvedValue({ id: 'o1', stripeCustomerId: 'cus_1' });
      const stripe: any = { billingPortal: { sessions: { create: jest.fn().mockResolvedValue({ url: 'https://portal' }) } } };
      const svc = new BillingService(stripe, prisma);
      const r = await svc.createPortal('o1');
      expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith({ customer: 'cus_1', return_url: 'https://app.test/billing' });
      expect(r).toEqual({ url: 'https://portal' });
    });
  });

  describe('getStatus', () => {
    it('throws NOT_FOUND when org missing', async () => {
      const prisma: any = makePrisma();
      prisma.org.findUnique.mockResolvedValue(null);
      const svc = new BillingService({} as any, prisma);
      await expect(svc.getStatus('o1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('reports plan/limit/usage with a subscription period', async () => {
      const prisma: any = makePrisma();
      prisma.org.findUnique.mockResolvedValue({
        id: 'o1', plan: 'starter', subStatus: 'active', createdAt: new Date('2024-01-01'),
        subscription: { currentPeriodEnd: new Date('2024-12-01') },
      });
      prisma.generationLog.count.mockResolvedValue(7);
      const svc = new BillingService({} as any, prisma);
      const r = await svc.getStatus('o1');
      expect(r).toMatchObject({ plan: 'starter', subStatus: 'active', used: 7, limit: 50 });
      expect(r.periodEnd).toEqual(new Date('2024-12-01'));
    });

    it('defaults subStatus/periodEnd to null and limit to 0 for unknown plan / no subscription', async () => {
      const prisma: any = makePrisma();
      prisma.org.findUnique.mockResolvedValue({
        id: 'o1', plan: 'mystery', subStatus: null, createdAt: new Date('2024-01-01'), subscription: null,
      });
      prisma.generationLog.count.mockResolvedValue(0);
      const svc = new BillingService({} as any, prisma);
      const r = await svc.getStatus('o1');
      expect(r.subStatus).toBeNull();
      expect(r.periodEnd).toBeNull();
      expect(r.limit).toBe(0);
    });
  });

  describe('ingestEvent', () => {
    const stripeOk = () => ({ webhooks: { constructEvent: jest.fn().mockReturnValue({ id: 'evt_1', type: 'x' }) } });

    it('throws VALIDATION on a bad signature', async () => {
      const prisma: any = makePrisma();
      const stripe: any = { webhooks: { constructEvent: jest.fn(() => { throw new Error('bad sig'); }) } };
      const svc = new BillingService(stripe, prisma);
      await expect(svc.ingestEvent('body', 'sig')).rejects.toMatchObject({ code: 'VALIDATION' });
    });

    it('acks without queueing when the event was already processed', async () => {
      const prisma: any = makePrisma();
      prisma.processedEvent.findUnique.mockResolvedValue({ id: 'evt_1' });
      const svc = new BillingService(stripeOk() as any, prisma);
      const r = await svc.ingestEvent('body', 'sig');
      expect(r).toEqual({ received: true });
      expect(prisma.webhookEvent.create).not.toHaveBeenCalled();
    });

    it('queues the event and kicks a fast-path drain', async () => {
      const prisma: any = makePrisma();
      prisma.processedEvent.findUnique.mockResolvedValue(null);
      prisma.webhookEvent.create.mockResolvedValue({});
      const svc = new BillingService(stripeOk() as any, prisma);
      const drainSpy = jest.spyOn(svc, 'drainPending').mockResolvedValue(0);
      const r = await svc.ingestEvent('body', 'sig');
      expect(prisma.webhookEvent.create).toHaveBeenCalled();
      expect(r).toEqual({ received: true });
      await new Promise((res) => setImmediate(res)); // let the setImmediate drain run
      expect(drainSpy).toHaveBeenCalled();
    });

    it('acks when a concurrent delivery already queued the same id (create conflict)', async () => {
      const prisma: any = makePrisma();
      prisma.processedEvent.findUnique.mockResolvedValue(null);
      prisma.webhookEvent.create.mockRejectedValue({ code: 'P2002' });
      const svc = new BillingService(stripeOk() as any, prisma);
      const r = await svc.ingestEvent('body', 'sig');
      expect(r).toEqual({ received: true });
    });

    it('tolerates a processedEvent lookup that rejects (defensive .catch)', async () => {
      const prisma: any = makePrisma();
      prisma.processedEvent.findUnique.mockRejectedValue(new Error('db blip'));
      prisma.webhookEvent.create.mockResolvedValue({});
      const svc = new BillingService(stripeOk() as any, prisma);
      jest.spyOn(svc, 'drainPending').mockResolvedValue(0);
      const r = await svc.ingestEvent('body', 'sig');
      expect(r).toEqual({ received: true });
    });
  });

  describe('drainPending', () => {
    it('returns 0 when nothing is due', async () => {
      const prisma: any = makePrisma();
      prisma.webhookEvent.findMany.mockResolvedValue([]);
      const svc = new BillingService({} as any, prisma);
      expect(await svc.drainPending()).toBe(0);
    });

    it('processes a claimed row to done', async () => {
      const prisma: any = makePrisma();
      prisma.webhookEvent.findMany.mockResolvedValue([{ id: 'r1', attempts: 0, payload: { type: 'noop' } }]);
      prisma.webhookEvent.updateMany.mockResolvedValue({ count: 1 });
      prisma.webhookEvent.update.mockResolvedValue({});
      const svc = new BillingService({} as any, prisma);
      jest.spyOn(svc as any, 'processEvent').mockResolvedValue(undefined);
      const n = await svc.drainPending();
      expect(n).toBe(1);
      expect(prisma.webhookEvent.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'done' }) }));
    });

    it('skips a row lost to a concurrent claim (count 0)', async () => {
      const prisma: any = makePrisma();
      prisma.webhookEvent.findMany.mockResolvedValue([{ id: 'r1', attempts: 0, payload: {} }]);
      prisma.webhookEvent.updateMany.mockResolvedValue({ count: 0 });
      const svc = new BillingService({} as any, prisma);
      const pe = jest.spyOn(svc as any, 'processEvent');
      expect(await svc.drainPending()).toBe(0);
      expect(pe).not.toHaveBeenCalled();
    });

    it('marks failed (retry) when processing throws below the attempt cap', async () => {
      const prisma: any = makePrisma();
      prisma.webhookEvent.findMany.mockResolvedValue([{ id: 'r1', attempts: 0, payload: {} }]);
      prisma.webhookEvent.updateMany.mockResolvedValue({ count: 1 });
      prisma.webhookEvent.update.mockResolvedValue({});
      const svc = new BillingService({} as any, prisma);
      jest.spyOn(svc as any, 'processEvent').mockRejectedValue(new Error('boom'));
      const errSpy = jest.spyOn((svc as any).logger, 'error').mockImplementation(() => undefined);
      expect(await svc.drainPending()).toBe(0);
      expect(prisma.webhookEvent.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }));
      expect(errSpy.mock.calls[0][0]).toContain('attempt 1/5');
    });

    it('stringifies a non-Error rejection when recording lastError (?? fallback)', async () => {
      const prisma: any = makePrisma();
      prisma.webhookEvent.findMany.mockResolvedValue([{ id: 'r1', attempts: 0, payload: {} }]);
      prisma.webhookEvent.updateMany.mockResolvedValue({ count: 1 });
      prisma.webhookEvent.update.mockResolvedValue({});
      const svc = new BillingService({} as any, prisma);
      jest.spyOn(svc as any, 'processEvent').mockRejectedValue('bare string');
      jest.spyOn((svc as any).logger, 'error').mockImplementation(() => undefined);
      await svc.drainPending();
      expect(prisma.webhookEvent.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ lastError: 'bare string' }) }));
    });

    it('dead-letters when the attempt cap is reached', async () => {
      const prisma: any = makePrisma();
      // row.attempts=4 → after the claim increment reflects attempts=5 = MAX
      prisma.webhookEvent.findMany.mockResolvedValue([{ id: 'r1', attempts: 4, payload: {} }]);
      prisma.webhookEvent.updateMany.mockResolvedValue({ count: 1 });
      prisma.webhookEvent.update.mockResolvedValue({});
      const svc = new BillingService({} as any, prisma);
      jest.spyOn(svc as any, 'processEvent').mockRejectedValue('bare cap failure'); // non-Error exercises the ?? fallback too
      const errSpy = jest.spyOn((svc as any).logger, 'error').mockImplementation(() => undefined);
      await svc.drainPending();
      expect(errSpy.mock.calls[0][0]).toContain('DEAD-LETTERED');
      expect(errSpy.mock.calls[0][0]).toContain('bare cap failure');
    });
  });

  describe('processEvent', () => {
    const subEvent = (over: any = {}) => ({
      id: 'evt_1',
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', current_period_end: 1_700_000_000, items: { data: [{ price: { id: 'price_starter' } }] }, ...over } },
    });

    it('binds to the org by Stripe customer and writes the transaction', async () => {
      const prisma: any = makePrisma();
      prisma.org.findFirst.mockResolvedValue({ id: 'o1' });
      const svc = new BillingService({} as any, prisma);
      await (svc as any).processEvent(subEvent());
      expect(prisma.subscription.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { orgId: 'o1' } }));
      expect(prisma.org.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ plan: 'starter', subStatus: 'active' }) }));
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('sets plan=free for subscription.deleted', async () => {
      const prisma: any = makePrisma();
      prisma.org.findFirst.mockResolvedValue({ id: 'o1' });
      const svc = new BillingService({} as any, prisma);
      await (svc as any).processEvent(subEvent({ id: 'sub_1' }));
      // override type to deleted
      const ev = subEvent();
      ev.type = 'customer.subscription.deleted';
      prisma.org.update.mockClear();
      await (svc as any).processEvent(ev);
      expect(prisma.org.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ plan: 'free' }) }));
    });

    it('falls back to metadata.orgId only when it maps to an unlinked org', async () => {
      const prisma: any = makePrisma();
      prisma.org.findFirst
        .mockResolvedValueOnce(null) // by customer: none
        .mockResolvedValueOnce({ id: 'o-claim' }); // by metadata orgId with null customer
      const svc = new BillingService({} as any, prisma);
      const ev = subEvent();
      ev.data.object.metadata = { orgId: 'o-claim' };
      await (svc as any).processEvent(ev);
      expect(prisma.subscription.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { orgId: 'o-claim' } }));
    });

    it('defaults current_period_end to now when the field is absent', async () => {
      const prisma: any = makePrisma();
      prisma.org.findFirst.mockResolvedValue({ id: 'o1' });
      const svc = new BillingService({} as any, prisma);
      const ev = subEvent();
      delete ev.data.object.current_period_end;
      ev.data.object.items = { data: [] }; // also exercise missing price -> ''
      await (svc as any).processEvent(ev);
      const upsertArg = prisma.subscription.upsert.mock.calls[0][0];
      expect(upsertArg.create.currentPeriodEnd).toBeInstanceOf(Date);
      expect(upsertArg.create.stripePriceId).toBe('');
    });

    it('only writes the processed marker when no org resolves', async () => {
      const prisma: any = makePrisma();
      prisma.org.findFirst.mockResolvedValue(null); // no customer, no metadata claim
      const svc = new BillingService({} as any, prisma);
      const ev = subEvent();
      delete ev.data.object.metadata;
      await (svc as any).processEvent(ev);
      expect(prisma.subscription.upsert).not.toHaveBeenCalled();
      expect(prisma.processedEvent.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'evt_1' } }));
    });

    it('marks non-subscription events as processed without side effects', async () => {
      const prisma: any = makePrisma();
      const svc = new BillingService({} as any, prisma);
      await (svc as any).processEvent({ id: 'evt_2', type: 'invoice.paid', data: { object: {} } });
      expect(prisma.org.findFirst).not.toHaveBeenCalled();
      expect(prisma.processedEvent.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'evt_2' } }));
    });

    it('maps the professional price id to the professional plan (env + literal fallback)', async () => {
      process.env.STRIPE_PRICE_PROFESSIONAL = 'price_env_pro';
      const prisma: any = makePrisma();
      prisma.org.findFirst.mockResolvedValue({ id: 'o1' });
      const svc = new BillingService({} as any, prisma);
      const ev = subEvent({ items: { data: [{ price: { id: 'price_env_pro' } }] } });
      await (svc as any).processEvent(ev);
      expect(prisma.org.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ plan: 'professional' }) }));
    });

    it('maps the agency price id (literal fallback price_agency) to the agency plan', async () => {
      delete process.env.STRIPE_PRICE_AGENCY;
      const prisma: any = makePrisma();
      prisma.org.findFirst.mockResolvedValue({ id: 'o1' });
      const svc = new BillingService({} as any, prisma);
      const ev = subEvent({ items: { data: [{ price: { id: 'price_agency' } }] } });
      await (svc as any).processEvent(ev);
      expect(prisma.org.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ plan: 'agency' }) }));
    });
  });

  describe('ingestEvent fast-path drain failure', () => {
    const stripeOk = () => ({ webhooks: { constructEvent: jest.fn().mockReturnValue({ id: 'evt_9', type: 'x' }) } });

    it('logs (does not throw) when the fast-path drain rejects with an Error', async () => {
      const prisma: any = makePrisma();
      prisma.processedEvent.findUnique.mockResolvedValue(null);
      prisma.webhookEvent.create.mockResolvedValue({});
      const svc = new BillingService(stripeOk() as any, prisma);
      const errSpy = jest.spyOn((svc as any).logger, 'error').mockImplementation(() => undefined);
      jest.spyOn(svc, 'drainPending').mockRejectedValue(new Error('drain blew up'));
      await svc.ingestEvent('body', 'sig');
      await new Promise((res) => setImmediate(res));
      expect(errSpy.mock.calls.some((c) => String(c[0]).includes('drain blew up'))).toBe(true);
    });

    it('logs a non-Error fast-path drain rejection verbatim (?? fallback)', async () => {
      const prisma: any = makePrisma();
      prisma.processedEvent.findUnique.mockResolvedValue(null);
      prisma.webhookEvent.create.mockResolvedValue({});
      const svc = new BillingService(stripeOk() as any, prisma);
      const errSpy = jest.spyOn((svc as any).logger, 'error').mockImplementation(() => undefined);
      jest.spyOn(svc, 'drainPending').mockRejectedValue('bare drain string');
      await svc.ingestEvent('body', 'sig');
      await new Promise((res) => setImmediate(res));
      expect(errSpy.mock.calls.some((c) => String(c[0]).includes('bare drain string'))).toBe(true);
    });
  });
});
