import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';
import { LlmService } from '../src/llm/llm.service';

// Job-Intelligence analysis is a paid LLM call, so it must consume quota like
// generation/regeneration — otherwise a free user gets unlimited paid analyses
// and the billing usage meter (GenerationLog) diverges from what is enforced.
describe('Jobs — intelligence (quota-gated)', () => {
  let app: INestApplication; let prisma: PrismaService;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LlmService).useValue({
        analyzeJob: jest.fn().mockResolvedValue({
          text: '{"objective":"Deliver the project","category":"web","seniority":"senior","complexity":"medium","estWeeks":8,"estBudgetUsd":32000,"winProbability":0.7,"why":["a"],"howToImprove":["b"],"recommendedStack":["next"],"integrations":["auth"],"deliverables":["discovery"],"risks":[],"questions":["q1"]}',
          provider: 'anthropic', model: 'claude-opus-4-8', promptTokens: 80, completionTokens: 200, costUsd: 0.0151, priceMapVersion: '2026-06-14',
        }),
      })
      .compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true })); app.useGlobalFilters(new AllExceptionsFilter());
    await app.init(); prisma = app.get(PrismaService);
  });
  afterAll(async () => { await app.close(); });

  it('analyzes a job, persists intelligence, logs cost once', async () => {
    await prisma.$executeRawUnsafe('TRUNCATE "QuotaPeriod","GenerationLog","Document","Profile","Membership","Job","Subscription","Org","User" RESTART IDENTITY CASCADE');
    const su = await request(app.getHttpServer()).post('/auth/signup').send({ email: 'i@x.com', password: 'pw1234567', name: 'I', agencyName: 'S', profession: 'developer' });
    const t = su.body.accessToken;
    const job = await request(app.getHttpServer()).post('/jobs').set({ Authorization: `Bearer ${t}` }).send({ title: 'Intel Job' });
    const res = await request(app.getHttpServer()).post(`/jobs/${job.body.id}/intelligence`).set({ Authorization: `Bearer ${t}` });
    expect(res.status).toBe(201);
    expect(res.body.objective).toBe('Deliver the project');
    const logs = await prisma.generationLog.findMany();
    expect(logs.length).toBe(1);
    expect(Number(logs[0].costUsd)).toBeGreaterThan(0);
  });

  it('enforces the free-plan boundary: analysis consumes a quota slot; the 4th call is 429', async () => {
    await prisma.$executeRawUnsafe('TRUNCATE "QuotaPeriod","GenerationLog","Document","Profile","Membership","Job","Subscription","Org","User" RESTART IDENTITY CASCADE');
    const su = await request(app.getHttpServer()).post('/auth/signup').send({ email: 'iq@x.com', password: 'pw1234567', name: 'Q', agencyName: 'S', profession: 'developer' });
    const t = su.body.accessToken;
    const job = await request(app.getHttpServer()).post('/jobs').set({ Authorization: `Bearer ${t}` }).send({ title: 'Intel Quota Job' });
    const jid = job.body.id;
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await request(app.getHttpServer()).post(`/jobs/${jid}/intelligence`).set({ Authorization: `Bearer ${t}` });
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 3)).toEqual([201, 201, 201]); // free limit (3) allowed
    expect(statuses[3]).toBe(429);                          // N+1 blocked

    // The billing usage meter must agree with enforcement — never exceed the limit.
    const status = await request(app.getHttpServer()).get('/billing/status').set({ Authorization: `Bearer ${t}` });
    expect(status.body.used).toBe(3);
    expect(status.body.limit).toBe(3);
  });
});
