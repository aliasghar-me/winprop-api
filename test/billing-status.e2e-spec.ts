import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';
import { STRIPE_CLIENT } from '../src/billing/billing.module';

describe('Billing status + portal', () => {
  let app: INestApplication; let prisma: PrismaService; let token: string;
  const stripeMock = {
    customers: { create: jest.fn().mockResolvedValue({ id: 'cus_1' }) },
    checkout: { sessions: { create: jest.fn().mockResolvedValue({ url: 'https://checkout.stripe/test' }) } },
    billingPortal: { sessions: { create: jest.fn().mockResolvedValue({ url: 'https://portal.stripe/test' }) } },
  };
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(STRIPE_CLIENT).useValue(stripeMock).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true })); app.useGlobalFilters(new AllExceptionsFilter());
    await app.init(); prisma = app.get(PrismaService);
    await prisma.$executeRawUnsafe('TRUNCATE "QuotaPeriod","GenerationLog","Profile","Membership","Job","Subscription","Org","User" RESTART IDENTITY CASCADE');
    const su = await request(app.getHttpServer()).post('/auth/signup').send({ email: 'b@x.com', password: 'pw1234567', name: 'B', agencyName: 'S', profession: 'developer' });
    token = su.body.accessToken;
  });
  afterAll(async () => { await app.close(); });
  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('reports plan + usage (free trial defaults)', async () => {
    const res = await request(app.getHttpServer()).get('/billing/status').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.plan).toBe('free');
    expect(res.body.limit).toBe(3); // free trial limit
    expect(res.body.used).toBe(0);
  });

  it('portal 400s before any subscription (no stripe customer yet)', async () => {
    const res = await request(app.getHttpServer()).post('/billing/portal').set(auth());
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION');
  });

  it('portal returns a session url once a customer exists', async () => {
    await request(app.getHttpServer()).post('/billing/checkout').set(auth()).send({ plan: 'starter' }); // creates cus_1
    const res = await request(app.getHttpServer()).post('/billing/portal').set(auth());
    expect(res.status).toBe(201);
    expect(res.body.url).toContain('portal.stripe');
  });
});
