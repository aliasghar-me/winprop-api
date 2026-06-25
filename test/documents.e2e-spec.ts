import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';
import { LlmService } from '../src/llm/llm.service';

describe('Documents — generate', () => {
  let app: INestApplication; let prisma: PrismaService; let token: string; let jobId: string;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LlmService).useValue({
        generateProposal: jest.fn().mockResolvedValue({
          text: '{"summary":"Great proposal","scope":["a"],"timelineWeeks":6,"priceUsd":24000,"closing":"Thanks"}',
          provider: 'anthropic', model: 'claude-opus-4-8', promptTokens: 100, completionTokens: 300, costUsd: 0.0237, priceMapVersion: '2026-06-14',
        }),
      })
      .compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true })); app.useGlobalFilters(new AllExceptionsFilter());
    await app.init(); prisma = app.get(PrismaService);
    await prisma.$executeRawUnsafe('TRUNCATE "QuotaPeriod","GenerationLog","Document","Profile","Membership","Job","Subscription","Org","User" RESTART IDENTITY CASCADE');
    const su = await request(app.getHttpServer()).post('/auth/signup').send({ email: 'o@x.com', password: 'pw1234567', name: 'O', agencyName: 'S', profession: 'developer' });
    token = su.body.accessToken;
    const job = await request(app.getHttpServer()).post('/jobs').set({ Authorization: `Bearer ${token}` }).send({ title: 'Acme', company: 'Acme' });
    jobId = job.body.id;
  });
  afterAll(async () => { await app.close(); });
  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('generates a proposal, persists it ready, logs cost once', async () => {
    const res = await request(app.getHttpServer()).post(`/jobs/${jobId}/documents`).set(auth()).send({ type: 'proposal' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('ready');
    expect(res.body.contentJson.priceUsd).toBe(24000);
    const logs = await prisma.generationLog.findMany();
    expect(logs.length).toBe(1);
    expect(Number(logs[0].costUsd)).toBeGreaterThan(0);
  });

  it('fetches the persisted document', async () => {
    const gen = await request(app.getHttpServer()).post(`/jobs/${jobId}/documents`).set(auth()).send({ type: 'proposal' });
    const res = await request(app.getHttpServer()).get(`/jobs/${jobId}/documents/${gen.body.id}`).set(auth());
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(gen.body.id);
  });

  it('enforces the free-plan boundary: 3 succeed, the 4th is 429 QUOTA_EXCEEDED', async () => {
    // fresh org so the count starts at 0 for this test
    await prisma.$executeRawUnsafe('TRUNCATE "QuotaPeriod","GenerationLog","Document","Profile","Membership","Job","Subscription","Org","User" RESTART IDENTITY CASCADE');
    const su = await request(app.getHttpServer()).post('/auth/signup').send({ email: 'q@x.com', password: 'pw1234567', name: 'Q', agencyName: 'S', profession: 'developer' });
    const t = su.body.accessToken;
    const job = await request(app.getHttpServer()).post('/jobs').set({ Authorization: `Bearer ${t}` }).send({ title: 'Quota Job' });
    const jid = job.body.id;
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await request(app.getHttpServer()).post(`/jobs/${jid}/documents`).set({ Authorization: `Bearer ${t}` }).send({ type: 'proposal' });
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 3)).toEqual([201, 201, 201]); // N allowed
    expect(statuses[3]).toBe(429);                          // N+1 blocked
    const last = await request(app.getHttpServer()).post(`/jobs/${jid}/documents`).set({ Authorization: `Bearer ${t}` }).send({ type: 'proposal' });
    expect(last.body.code).toBe('QUOTA_EXCEEDED');
  });
});
