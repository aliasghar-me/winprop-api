import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';
import { LlmService } from '../src/llm/llm.service';
import { MailService } from '../src/mail/mail.service';

// Generation must be blocked until the account's email is verified (security #1).
describe('Email verification gate', () => {
  let app: INestApplication; let prisma: PrismaService;
  let lastVerifyUrl = '';
  const prevFlag = process.env.EMAIL_VERIFICATION_REQUIRED;

  beforeAll(async () => {
    process.env.EMAIL_VERIFICATION_REQUIRED = 'true'; // force the gate on for this spec
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LlmService).useValue({
        generateProposal: jest.fn().mockResolvedValue({
          text: '{"summary":"S","scope":["a"],"timelineWeeks":6,"priceUsd":24000,"closing":"T"}',
          provider: 'anthropic', model: 'claude-opus-4-8', promptTokens: 10, completionTokens: 20, costUsd: 0.01, priceMapVersion: '2026-06-14',
        }),
      })
      .overrideProvider(MailService).useValue({
        sendVerificationEmail: jest.fn(async (_to: string, url: string) => { lastVerifyUrl = url; }),
      })
      .compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true })); app.useGlobalFilters(new AllExceptionsFilter());
    await app.init(); prisma = app.get(PrismaService);
    await prisma.$executeRawUnsafe('TRUNCATE "EmailVerificationToken","QuotaPeriod","GenerationLog","Document","Profile","Membership","Job","Subscription","Org","User" RESTART IDENTITY CASCADE');
  });
  afterAll(async () => { process.env.EMAIL_VERIFICATION_REQUIRED = prevFlag; await app.close(); });

  const tokenFromUrl = (url: string) => new URL(url).searchParams.get('token') ?? '';

  it('blocks generation while unverified, then allows it after verifying', async () => {
    const su = await request(app.getHttpServer()).post('/auth/signup').send({ email: 'v@x.com', password: 'pw1234567', name: 'V', agencyName: 'S', profession: 'developer' });
    const t = su.body.accessToken;
    const job = await request(app.getHttpServer()).post('/jobs').set({ Authorization: `Bearer ${t}` }).send({ title: 'Verify Job' });

    // signup sent a verification email (captured by the MailService mock)
    expect(lastVerifyUrl).toContain('/verify-email?token=');

    const blocked = await request(app.getHttpServer()).post(`/jobs/${job.body.id}/documents`).set({ Authorization: `Bearer ${t}` }).send({ type: 'proposal' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('EMAIL_NOT_VERIFIED');

    // verify with the emailed token
    const verify = await request(app.getHttpServer()).post('/auth/verify-email').send({ token: tokenFromUrl(lastVerifyUrl) });
    expect(verify.status).toBe(201);

    const ok = await request(app.getHttpServer()).post(`/jobs/${job.body.id}/documents`).set({ Authorization: `Bearer ${t}` }).send({ type: 'proposal' });
    expect(ok.status).toBe(201);
  });

  it('rejects an invalid or reused verification token', async () => {
    const bad = await request(app.getHttpServer()).post('/auth/verify-email').send({ token: 'not-a-real-token' });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('INVALID_TOKEN');
  });
});
