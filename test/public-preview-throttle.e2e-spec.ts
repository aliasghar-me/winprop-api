import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { I18nValidationPipe } from 'nestjs-i18n';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CryptoService } from '../src/common/crypto/crypto.service';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';
import { PREVIEW_THROTTLE } from '../src/public/public.controller';

// Anonymous funnel teaser is @Throttle'd (PREVIEW_THROTTLE) per IP. Rate limiting
// is globally skipped in the e2e suite (setup-throttle.ts); re-enable it just for
// this spec to prove the limiter actually fires (mirrors rate-limit.e2e-spec.ts).
// Driven off PREVIEW_THROTTLE.limit so the test never drifts from the configured value.
describe('preview throttle (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const prevThrottle = process.env.THROTTLE_DISABLED;
  const prevMock = process.env.LLM_MOCK;

  beforeAll(async () => {
    process.env.THROTTLE_DISABLED = '0'; // actually enforce limits (mirror rate-limit spec)
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
    process.env.THROTTLE_DISABLED = prevThrottle;
    process.env.LLM_MOCK = prevMock;
    await app?.close();
  });

  it(`allows ${PREVIEW_THROTTLE.limit} then 429s the next from the same IP`, async () => {
    const body = { title: 'A project', description: 'A description' };
    const server = app.getHttpServer();
    const post = () =>
      request(server).post('/public/proposals/preview').set('X-Forwarded-For', '9.9.9.9').send(body);

    // The first PREVIEW_THROTTLE.limit requests are allowed (200)...
    for (let i = 0; i < PREVIEW_THROTTLE.limit; i++) {
      const res = await post();
      expect(res.status).toBe(200);
    }
    // ...and the one past the limit is throttled (429).
    const over = await post();
    expect(over.status).toBe(429);
  });
});
