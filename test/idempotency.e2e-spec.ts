import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';
import { LlmService } from '../src/llm/llm.service';

// T2.4 — a retried mutation carrying the same Idempotency-Key replays the original
// result instead of re-executing (no double quota charge).
describe('Idempotency keys', () => {
  let app: INestApplication; let prisma: PrismaService; let token: string; let jobId: string;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LlmService).useValue({
        generateProposal: jest.fn().mockResolvedValue({
          text: '{"summary":"S","scope":["a"],"timelineWeeks":6,"priceUsd":24000,"closing":"T"}',
          provider: 'anthropic', model: 'claude-opus-4-8', promptTokens: 10, completionTokens: 20, costUsd: 0.01, priceMapVersion: '2026-06-14',
        }),
      })
      .compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true })); app.useGlobalFilters(new AllExceptionsFilter());
    await app.init(); prisma = app.get(PrismaService);
    await prisma.$executeRawUnsafe('TRUNCATE "IdempotencyKey","QuotaPeriod","GenerationLog","DocumentVersion","Document","Profile","Membership","Job","Subscription","Org","User" RESTART IDENTITY CASCADE');
    const su = await request(app.getHttpServer()).post('/auth/signup').send({ email: 'idem@x.com', password: 'pw1234567', name: 'I', agencyName: 'S', profession: 'developer' });
    token = su.body.accessToken;
    const job = await request(app.getHttpServer()).post('/jobs').set({ Authorization: `Bearer ${token}` }).send({ title: 'Idem Job' });
    jobId = job.body.id;
  });
  afterAll(async () => { await app.close(); });
  const auth = () => ({ Authorization: `Bearer ${token}`, 'Idempotency-Key': 'gen-key-1' });

  it('replays the cached response and does not double-charge quota on retry', async () => {
    const first = await request(app.getHttpServer()).post(`/jobs/${jobId}/documents`).set(auth()).send({ type: 'proposal' });
    expect(first.status).toBe(201);

    const second = await request(app.getHttpServer()).post(`/jobs/${jobId}/documents`).set(auth()).send({ type: 'proposal' });
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id); // same document, not a new one

    // Only one generation actually ran → quota charged once.
    const logs = await prisma.generationLog.count();
    expect(logs).toBe(1);
    const docs = await prisma.document.count();
    expect(docs).toBe(1);
  });

  it('a different key triggers a real (separate) execution', async () => {
    const res = await request(app.getHttpServer()).post(`/jobs/${jobId}/documents`)
      .set({ Authorization: `Bearer ${token}`, 'Idempotency-Key': 'gen-key-2' }).send({ type: 'proposal' });
    expect(res.status).toBe(201);
    expect(await prisma.document.count()).toBe(2);
  });
});
