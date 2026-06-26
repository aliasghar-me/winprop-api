import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { STRIPE_CLIENT } from '../src/billing/billing.module';
import { BillingService } from '../src/billing/billing.service';

function makeEvent(orgId: string) {
  return {
    id: 'evt_1', type: 'customer.subscription.updated',
    data: { object: {
      id: 'sub_1', status: 'active', customer: 'cus_1',
      items: { data: [{ price: { id: 'price_pro' } }] },
      current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600, metadata: { orgId },
    } },
  };
}

describe('Billing webhook (durable inbox, async processing)', () => {
  let app: INestApplication; let prisma: PrismaService; let billing: BillingService;
  let orgId: string; let event: any;
  const stripeMock = { webhooks: { constructEvent: jest.fn() } };
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(STRIPE_CLIENT).useValue(stripeMock).compile();
    app = mod.createNestApplication();
    await app.init(); prisma = app.get(PrismaService); billing = app.get(BillingService);
    await prisma.$executeRawUnsafe('TRUNCATE "WebhookEvent","ProcessedEvent","Subscription","Profile","Membership","Job","Org","User" RESTART IDENTITY CASCADE');
    await request(app.getHttpServer()).post('/auth/signup').send({ email: 'o@x.com', password: 'pw1234567', name: 'O', agencyName: 'S', profession: 'developer' });
    const org = await prisma.org.findFirst(); orgId = org!.id;
    await prisma.org.update({ where: { id: orgId }, data: { stripeCustomerId: 'cus_1' } });
    event = makeEvent(orgId);
  });
  afterAll(async () => {
    // Purge queued rows so a later test app's drain doesn't reclaim them (FK noise).
    await prisma.$executeRawUnsafe('TRUNCATE "WebhookEvent","ProcessedEvent" RESTART IDENTITY CASCADE');
    await app.close();
  });

  // Processing is async (the in-request setImmediate drain may already own the row).
  // Poll — nudging a drain each round — until the event reaches a terminal state.
  async function waitForStatus(id: string, want: string, tries = 50): Promise<string | undefined> {
    for (let i = 0; i < tries; i++) {
      await billing.drainPending();
      const row = await prisma.webhookEvent.findUnique({ where: { id } });
      if (row?.status === want) return row.status;
      await new Promise((r) => setTimeout(r, 20));
    }
    return (await prisma.webhookEvent.findUnique({ where: { id } }))?.status;
  }

  it('rejects a bad signature with 400 and queues nothing', async () => {
    stripeMock.webhooks.constructEvent.mockImplementationOnce(() => { throw new Error('bad sig'); });
    const res = await request(app.getHttpServer()).post('/billing/webhook').set('stripe-signature', 'bad').send(event);
    expect(res.status).toBe(400);
    expect(await prisma.webhookEvent.count()).toBe(0); // never reaches the inbox
    expect(await prisma.subscription.count()).toBe(0);
  });

  it('acks 202 immediately, queues the event, then processes it on drain (idempotent on replay)', async () => {
    stripeMock.webhooks.constructEvent.mockReturnValue(event);
    const r1 = await request(app.getHttpServer()).post('/billing/webhook').set('stripe-signature', 't').send(event);
    expect(r1.status).toBe(202);             // fast ack, work deferred
    expect(r1.body.received).toBe(true);
    expect(await prisma.webhookEvent.count()).toBe(1); // durably queued

    expect(await waitForStatus('evt_1', 'done')).toBe('done');
    const sub = await prisma.subscription.findFirst();
    expect(sub?.status).toBe('active');
    const org = await prisma.org.findUnique({ where: { id: orgId } });
    expect(org?.plan).toBe('pro');                 // mapped from price_pro
    expect(org?.subStatus).toBe('active');
    expect(await prisma.processedEvent.count()).toBe(1);

    // Replay the SAME event id: deduped at ingest, nothing new queued or processed.
    const r2 = await request(app.getHttpServer()).post('/billing/webhook').set('stripe-signature', 't').send(event);
    expect(r2.status).toBe(202);
    await billing.drainPending();
    await new Promise((r) => setTimeout(r, 30)); // let any fast-path drain settle
    expect(await prisma.webhookEvent.count()).toBe(1);
    expect(await prisma.subscription.count()).toBe(1);
    expect(await prisma.processedEvent.count()).toBe(1); // recorded once
  });

  it('recovers a row left pending by a crash (durability backstop)', async () => {
    // Simulate: event was queued, but the process died before any drain ran.
    const evt = makeEvent(orgId);
    evt.id = 'evt_crash'; evt.data.object.id = 'sub_crash';
    await prisma.webhookEvent.create({ data: { id: evt.id, type: evt.type, payload: evt as any } });

    expect(await waitForStatus('evt_crash', 'done')).toBe('done'); // == processor restart drain
    expect(await prisma.processedEvent.findUnique({ where: { id: 'evt_crash' } })).not.toBeNull();
  });

  it('reclaims a row stuck in processing by a crashed worker (H1)', async () => {
    // Simulate: a worker claimed the row (status=processing) then died before finishing.
    const evt = makeEvent(orgId);
    evt.id = 'evt_stuck'; evt.data.object.id = 'sub_stuck';
    await prisma.webhookEvent.create({
      data: {
        id: evt.id, type: evt.type, payload: evt as any,
        status: 'processing', attempts: 1,
        claimedAt: new Date(Date.now() - 10 * 60_000), // claimed 10 min ago → past the stuck window
      },
    });

    expect(await waitForStatus('evt_stuck', 'done')).toBe('done');
    expect(await prisma.processedEvent.findUnique({ where: { id: 'evt_stuck' } })).not.toBeNull();
  });

  it('does NOT reclaim a freshly-claimed processing row (still in flight)', async () => {
    const evt = makeEvent(orgId);
    evt.id = 'evt_inflight';
    await prisma.webhookEvent.create({
      data: { id: evt.id, type: evt.type, payload: evt as any, status: 'processing', attempts: 1, claimedAt: new Date() },
    });
    await billing.drainPending();
    const row = await prisma.webhookEvent.findUnique({ where: { id: 'evt_inflight' } });
    expect(row?.status).toBe('processing'); // untouched — another worker owns it
  });
});
