import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { I18nValidationPipe } from 'nestjs-i18n';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CryptoService } from '../src/common/crypto/crypto.service';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';

// Anonymous free-trial funnel: 3 verdicts then 402, 1 proposal then 402, honeypot
// rejection, and a privacy check that no RAW client IP is persisted.
describe('Anonymous trial (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const prevMock = process.env.LLM_MOCK;

  const fingerprint = { visitorId: 'e2e-visitor', userAgent: 'e2e-UA', timezone: 'UTC', language: 'en', platform: 'TestOS' };
  const body = (over: any = {}) => ({ title: 'Marketing site rebuild', description: 'A 5-page site for a law firm', fingerprint, ...over });

  beforeAll(async () => {
    process.env.LLM_MOCK = 'true';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new I18nValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    prisma = app.get(PrismaService);
    const crypto = app.get(CryptoService);
    await prisma.$executeRawUnsafe('TRUNCATE "TrialUsage" RESTART IDENTITY CASCADE');
    await prisma.llmConfig.deleteMany({ where: { orgId: null } });
    await prisma.llmConfig.create({
      data: { orgId: null, provider: 'openai', model: 'mock', apiKeyEncrypted: crypto.encrypt('test-key') },
    });
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE "TrialUsage" RESTART IDENTITY CASCADE');
    await prisma.llmConfig.deleteMany({ where: { orgId: null } });
    process.env.LLM_MOCK = prevMock;
    await app?.close();
  });

  it('allows 3 verdicts then walls the 4th with 402', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await request(app.getHttpServer()).post('/public/assess').send(body()).expect(200);
      expect(res.body.analysis).toHaveProperty('recommendation');
      expect(res.body.remaining.verdicts).toBe(2 - i);
    }
    const walled = await request(app.getHttpServer()).post('/public/assess').send(body()).expect(402);
    expect(walled.body.reason).toBe('budget');
    expect(walled.body.remaining.verdicts).toBe(0);
  });

  it('allows 1 proposal then walls the 2nd with 402 and sets trial_used cookie', async () => {
    const ok = await request(app.getHttpServer()).post('/public/proposal').send(body()).expect(200);
    expect(ok.body.proposal).toHaveProperty('summary');
    expect(ok.headers['set-cookie'].join(';')).toContain('trial_used=1');

    const walled = await request(app.getHttpServer()).post('/public/proposal').send(body()).expect(402);
    expect(walled.body.reason).toBe('proposal_used');
  });

  it('rejects a filled honeypot with 400', async () => {
    await request(app.getHttpServer())
      .post('/public/assess')
      .send(body({ website: 'http://spam.example' }))
      .expect(400);
  });

  it('rejects a missing fingerprint with 400', async () => {
    await request(app.getHttpServer())
      .post('/public/assess')
      .send({ title: 'X', description: 'Y' })
      .expect(400);
  });

  it('persists HASHES ONLY — no raw client IP in the row', async () => {
    const rows = await prisma.trialUsage.findMany();
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.ipHash).toMatch(/^[0-9a-f]{64}$/);
      // The e2e client IP (loopback) must never be stored raw anywhere in the row.
      const serialized = JSON.stringify(r);
      expect(serialized).not.toContain('127.0.0.1');
      expect(serialized).not.toContain('::1');
      expect(serialized).not.toContain('e2e-visitor');
      expect(serialized).not.toContain('e2e-UA');
    }
  });
});
