import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';
import { STRIPE_CLIENT } from '../src/billing/billing.module';

describe('Billing checkout', () => {
  let app: INestApplication; let prisma: PrismaService; let token: string;
  const stripeMock = {
    customers: { create: jest.fn().mockResolvedValue({ id: 'cus_1' }) },
    checkout: { sessions: { create: jest.fn().mockResolvedValue({ url: 'https://checkout.stripe/test' }) } },
  };
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(STRIPE_CLIENT).useValue(stripeMock).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true })); app.useGlobalFilters(new AllExceptionsFilter());
    await app.init(); prisma = app.get(PrismaService);
    await prisma.$executeRawUnsafe('TRUNCATE "Profile","Membership","Job","Subscription","Org","User" RESTART IDENTITY CASCADE');
    const su = await request(app.getHttpServer()).post('/auth/signup').send({ email: 'o@x.com', password: 'pw1234567', name: 'O', agencyName: 'S', profession: 'developer' });
    token = su.body.accessToken;
  });
  afterAll(async () => { await app.close(); });

  it('creates a checkout session and a stripe customer', async () => {
    const res = await request(app.getHttpServer()).post('/billing/checkout').set({ Authorization: `Bearer ${token}` }).send({ plan: 'professional' });
    expect(res.status).toBe(201);
    expect(res.body.url).toContain('checkout.stripe');
    expect(stripeMock.customers.create).toHaveBeenCalled();
    const org = await prisma.org.findFirst();
    expect(org?.stripeCustomerId).toBe('cus_1');
  });
});
