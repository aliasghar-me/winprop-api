import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';
import { LlmService } from '../src/llm/llm.service';

// T1.3 — Adjust tone (re-runs prose) and Adjust pricing (clamped to range);
// each writes a labeled timeline version and is quota-gated.
describe('Document adjust (tone / pricing)', () => {
  let app: INestApplication; let prisma: PrismaService; let token: string; let jobId: string; let docId: string;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LlmService).useValue({
        generateProposal: jest.fn().mockResolvedValue({
          text: '{"summary":"orig summary","scope":["a"],"timelineWeeks":6,"priceUsd":24000,"closing":"orig closing"}',
          provider: 'anthropic', model: 'claude-opus-4-8', promptTokens: 10, completionTokens: 20, costUsd: 0.01, priceMapVersion: '2026-06-14',
        }),
        adjustToneProse: jest.fn().mockResolvedValue({
          summary: 'AGGRESSIVE summary', closing: 'AGGRESSIVE closing',
          provider: 'anthropic', model: 'claude-opus-4-8', promptTokens: 10, completionTokens: 20, costUsd: 0.01, priceMapVersion: '2026-06-14',
        }),
        // Pricing regen returns an out-of-range value to prove server-side clamping.
        regenerateSection: jest.fn().mockResolvedValue({
          key: 'priceUsd', value: 999999,
          provider: 'anthropic', model: 'claude-opus-4-8', promptTokens: 10, completionTokens: 20, costUsd: 0.01, priceMapVersion: '2026-06-14',
        }),
      })
      .compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true })); app.useGlobalFilters(new AllExceptionsFilter());
    await app.init(); prisma = app.get(PrismaService);
    await prisma.$executeRawUnsafe('TRUNCATE "EmailVerificationToken","QuotaPeriod","GenerationLog","DocumentVersion","Document","Profile","Membership","Job","Subscription","Org","User" RESTART IDENTITY CASCADE');
    const su = await request(app.getHttpServer()).post('/auth/signup').send({ email: 'adj@x.com', password: 'pw1234567', name: 'A', agencyName: 'S', profession: 'developer' });
    token = su.body.accessToken;
    // Ample quota so these functional assertions aren't constrained by the free cap
    // (quota gating itself is covered in documents/jobs-intelligence specs).
    await prisma.org.updateMany({ data: { plan: 'professional' } });
    // generation gate is off in tests (setup-throttle), so generate directly
    const job = await request(app.getHttpServer()).post('/jobs').set({ Authorization: `Bearer ${token}` }).send({ title: 'Adj Job' });
    jobId = job.body.id;
    const gen = await request(app.getHttpServer()).post(`/jobs/${jobId}/documents`).set({ Authorization: `Bearer ${token}` }).send({ type: 'proposal' });
    docId = gen.body.id;
  });
  afterAll(async () => { await app.close(); });
  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('adjust-tone rewrites prose and records a tone-adjust version', async () => {
    const res = await request(app.getHttpServer()).post(`/jobs/${jobId}/documents/${docId}/adjust-tone`).set(auth()).send({ tone: 'aggressive' });
    expect(res.status).toBe(201);
    expect(res.body.contentJson.summary).toBe('AGGRESSIVE summary');
    expect(res.body.contentJson.closing).toBe('AGGRESSIVE closing');
    expect(res.body.contentJson.priceUsd).toBe(24000); // untouched
    const versions = await prisma.documentVersion.findMany({ where: { documentId: docId } });
    expect(versions.some((v) => v.label === 'tone-adjust')).toBe(true);
  });

  it('rejects an invalid tone', async () => {
    const res = await request(app.getHttpServer()).post(`/jobs/${jobId}/documents/${docId}/adjust-tone`).set(auth()).send({ tone: 'snarky' });
    expect(res.status).toBe(400);
  });

  it('adjust-pricing clamps to the agency range and records a pricing-adjust version', async () => {
    const profile = await prisma.profile.findFirst();
    const res = await request(app.getHttpServer()).post(`/jobs/${jobId}/documents/${docId}/adjust-pricing`).set(auth());
    expect(res.status).toBe(201);
    expect(res.body.contentJson.priceUsd).toBe(profile!.priceMax); // 999999 clamped down to max
    expect(res.body.contentJson.priceUsd).toBeLessThanOrEqual(profile!.priceMax);
    expect(res.body.contentJson.priceUsd).toBeGreaterThanOrEqual(profile!.priceMin);
    const versions = await prisma.documentVersion.findMany({ where: { documentId: docId } });
    expect(versions.some((v) => v.label === 'pricing-adjust')).toBe(true);
  });
});
