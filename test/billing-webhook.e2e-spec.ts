import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { STRIPE_CLIENT } from '../src/billing/billing.module';

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

describe('Billing webhook (source of truth)', () => {
  let app: INestApplication; let prisma: PrismaService; let orgId: string; let event: any;
  const stripeMock = { webhooks: { constructEvent: jest.fn() } };
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(STRIPE_CLIENT).useValue(stripeMock).compile();
    app = mod.createNestApplication();
    await app.init(); prisma = app.get(PrismaService);
    await prisma.$executeRawUnsafe('TRUNCATE "ProcessedEvent","Subscription","Profile","Membership","Job","Org","User" RESTART IDENTITY CASCADE');
    await request(app.getHttpServer()).post('/auth/signup').send({ email: 'o@x.com', password: 'pw1234567', name: 'O', agencyName: 'S', profession: 'developer' });
    const org = await prisma.org.findFirst(); orgId = org!.id;
    await prisma.org.update({ where: { id: orgId }, data: { stripeCustomerId: 'cus_1' } });
    event = makeEvent(orgId);
  });
  afterAll(async () => { await app.close(); });

  it('rejects a bad signature with 400', async () => {
    stripeMock.webhooks.constructEvent.mockImplementationOnce(() => { throw new Error('bad sig'); });
    const res = await request(app.getHttpServer()).post('/billing/webhook').set('stripe-signature', 'bad').send(event);
    expect(res.status).toBe(400);
    expect(await prisma.subscription.count()).toBe(0); // nothing written on bad sig
  });

  it('writes Subscription + updates Org cache, idempotent on replay', async () => {
    stripeMock.webhooks.constructEvent.mockReturnValue(event);
    const r1 = await request(app.getHttpServer()).post('/billing/webhook').set('stripe-signature', 't').send(event);
    expect(r1.status).toBe(200);
    const sub = await prisma.subscription.findFirst();
    expect(sub?.status).toBe('active');
    const org = await prisma.org.findUnique({ where: { id: orgId } });
    expect(org?.plan).toBe('pro');                 // mapped from price_pro
    expect(org?.subStatus).toBe('active');
    // replay the SAME event id
    const r2 = await request(app.getHttpServer()).post('/billing/webhook').set('stripe-signature', 't').send(event);
    expect(r2.status).toBe(200);
    expect(await prisma.subscription.count()).toBe(1);
    expect(await prisma.processedEvent.count()).toBe(1); // recorded once
  });
});
