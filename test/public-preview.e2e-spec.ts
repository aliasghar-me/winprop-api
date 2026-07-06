import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { I18nValidationPipe } from 'nestjs-i18n';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CryptoService } from '../src/common/crypto/crypto.service';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';

// Anonymous funnel teaser: validates {title, description, website?}, rejects a
// filled honeypot, and (mock LLM provider) returns exactly one visible section.
describe('POST /public/proposals/preview (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const prevMock = process.env.LLM_MOCK;

  beforeAll(async () => {
    process.env.LLM_MOCK = 'true'; // register the mock provider at module init
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    // Mirror main.ts global pipe/filter so validation + i18n behave identically.
    app.useGlobalPipes(new I18nValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    prisma = app.get(PrismaService);
    const crypto = app.get(CryptoService);
    await prisma.llmConfig.deleteMany({ where: { orgId: null } });
    // provider must be a valid LlmVendor ('openai' | 'anthropic'); resolveProvider()
    // swaps in the mock provider whenever LLM_MOCK=true regardless of this value.
    await prisma.llmConfig.create({
      data: { orgId: null, provider: 'openai', model: 'mock', apiKeyEncrypted: crypto.encrypt('test-key') },
    });
  });

  afterAll(async () => {
    await prisma.llmConfig.deleteMany({ where: { orgId: null } });
    process.env.LLM_MOCK = prevMock;
    await app?.close();
  });

  it('returns one visible section + locked titles', async () => {
    const res = await request(app.getHttpServer())
      .post('/public/proposals/preview')
      .send({ title: 'Marketing site rebuild', description: 'A 5-page site for a law firm' })
      .expect(201);
    expect(res.body.sections).toHaveLength(1);
    expect(res.body.sections[0]).toHaveProperty('heading');
    expect(res.body.sections[0]).toHaveProperty('body');
    expect(Array.isArray(res.body.lockedTitles)).toBe(true);
    expect(res.body.lockedTitles.length).toBeGreaterThan(0);
  });

  it('rejects a filled honeypot with 400', async () => {
    await request(app.getHttpServer())
      .post('/public/proposals/preview')
      .send({ title: 'X', description: 'Y', website: 'http://spam.example' })
      .expect(400);
  });

  it('rejects a missing title with 400', async () => {
    await request(app.getHttpServer())
      .post('/public/proposals/preview')
      .send({ description: 'Y' })
      .expect(400);
  });
});
