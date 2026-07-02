import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';
import { LlmService } from '../src/llm/llm.service';

// Tier 3 — reuse: duplicate a document into a fresh v1 (no LLM/quota).
describe('Document duplicate (reuse)', () => {
  let app: INestApplication; let prisma: PrismaService; let token: string; let jobId: string; let docId: string; let tokenB: string;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LlmService).useValue({
        generateProposal: jest.fn().mockResolvedValue({
          text: '{"summary":"reuse me","scope":["a"],"timelineWeeks":6,"priceUsd":24000,"closing":"T"}',
          provider: 'anthropic', model: 'claude-opus-4-8', promptTokens: 10, completionTokens: 20, costUsd: 0.01, priceMapVersion: '2026-06-14',
        }),
      })
      .compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true })); app.useGlobalFilters(new AllExceptionsFilter());
    await app.init(); prisma = app.get(PrismaService);
    await prisma.$executeRawUnsafe('TRUNCATE "IdempotencyKey","QuotaPeriod","GenerationLog","DocumentVersion","Document","Profile","Membership","Job","Subscription","Org","User" RESTART IDENTITY CASCADE');
    const su = await request(app.getHttpServer()).post('/auth/signup').send({ email: 'dup@x.com', password: 'pw1234567', name: 'D', agencyName: 'S', profession: 'developer' });
    token = su.body.accessToken;
    const b = await request(app.getHttpServer()).post('/auth/signup').send({ email: 'dupb@x.com', password: 'pw1234567', name: 'B', agencyName: 'B', profession: 'developer' });
    tokenB = b.body.accessToken;
    const job = await request(app.getHttpServer()).post('/jobs').set({ Authorization: `Bearer ${token}` }).send({ title: 'Dup Job' });
    jobId = job.body.id;
    const gen = await request(app.getHttpServer()).post(`/jobs/${jobId}/documents`).set({ Authorization: `Bearer ${token}` }).send({ type: 'proposal' });
    docId = gen.body.id;
  });
  afterAll(async () => { await app.close(); });

  it('clones the document content into a new v1 (no quota consumed)', async () => {
    const before = await prisma.generationLog.count();
    const res = await request(app.getHttpServer()).post(`/jobs/${jobId}/documents/${docId}/duplicate`).set({ Authorization: `Bearer ${token}` }).send({});
    expect(res.status).toBe(201);
    expect(res.body.id).not.toBe(docId);
    expect(res.body.title).toContain('(copy)');
    expect(res.body.contentJson.summary).toBe('reuse me');
    expect(res.body.version).toBe(1);
    expect(await prisma.generationLog.count()).toBe(before); // copy != generation
    expect(await prisma.document.count()).toBe(2);
  });

  it('is tenant-scoped: another org cannot duplicate the doc', async () => {
    const res = await request(app.getHttpServer()).post(`/jobs/${jobId}/documents/${docId}/duplicate`).set({ Authorization: `Bearer ${tokenB}` }).send({});
    expect(res.status).toBe(404);
  });
});
