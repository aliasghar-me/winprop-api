import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { I18nValidationPipe } from 'nestjs-i18n';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CryptoService } from '../src/common/crypto/crypto.service';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';

/**
 * Additional coverage for POST /public/proposals/preview, complementing
 * public-preview.e2e-spec.ts (happy path + honeypot + missing title) and
 * public-preview-throttle.e2e-spec.ts (rate limit). These cover the DTO/HTTP
 * edge cases that were previously untested.
 */
describe('POST /public/proposals/preview — validation & config edges (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let crypto: CryptoService;
  const prevMock = process.env.LLM_MOCK;

  const seedConfig = () =>
    prisma.llmConfig.create({
      data: { orgId: null, provider: 'openai', model: 'mock', apiKeyEncrypted: crypto.encrypt('test-key') },
    });

  const valid = { title: 'Coffee roaster brand', description: 'Brand and website for a specialty coffee roaster.' };

  beforeAll(async () => {
    process.env.LLM_MOCK = 'true';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new I18nValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    prisma = app.get(PrismaService);
    crypto = app.get(CryptoService);
    await prisma.llmConfig.deleteMany({ where: { orgId: null } });
    await seedConfig();
  });

  afterAll(async () => {
    await prisma.llmConfig.deleteMany({ where: { orgId: null } });
    process.env.LLM_MOCK = prevMock;
    await app?.close();
  });

  it('returns HTTP 200 (not 201) for a successful POST', async () => {
    const res = await request(app.getHttpServer()).post('/public/proposals/preview').send(valid);
    expect(res.status).toBe(200);
    expect(res.body.sections).toHaveLength(1);
    expect(res.body.lockedTitles.length).toBeGreaterThan(0);
  });

  it('strips unknown body fields (whitelist) and still succeeds', async () => {
    const res = await request(app.getHttpServer())
      .post('/public/proposals/preview')
      .send({ ...valid, injected: 'should be ignored', isAdmin: true });
    expect(res.status).toBe(200);
    expect(res.body.sections).toHaveLength(1);
  });

  it('rejects a whitespace-only title with 400 (trimmed to empty)', async () => {
    const res = await request(app.getHttpServer())
      .post('/public/proposals/preview')
      .send({ title: '   ', description: valid.description });
    expect(res.status).toBe(400);
  });

  it('rejects an over-length title (>200) with 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/public/proposals/preview')
      .send({ title: 'a'.repeat(201), description: valid.description });
    expect(res.status).toBe(400);
  });

  it('rejects an over-length description (>5000) with 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/public/proposals/preview')
      .send({ title: valid.title, description: 'a'.repeat(5001) });
    expect(res.status).toBe(400);
  });

  it('rejects an over-length honeypot website (>200) with 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/public/proposals/preview')
      .send({ ...valid, website: 'a'.repeat(201) });
    expect(res.status).toBe(400);
  });

  it('returns 503 LLM_NOT_CONFIGURED when no platform llmConfig exists', async () => {
    await prisma.llmConfig.deleteMany({ where: { orgId: null } });
    try {
      const res = await request(app.getHttpServer()).post('/public/proposals/preview').send(valid);
      expect(res.status).toBe(503);
    } finally {
      await seedConfig(); // restore for any later tests / the shared dev DB
    }
  });
});
