import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';
import { LlmService } from '../src/llm/llm.service';

// "Should I Apply?" MVP — assess (paste → verdict), outcome recording, and the
// Revenue dashboard, end-to-end. LlmService is overridden so no real key/DB-config.
describe('Jobs — assess + outcome + revenue analytics (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const ANALYSIS = JSON.stringify({
    objective: 'Deliver a Next.js marketing site',
    domain: 'Web', seniority: 'Senior', complexity: 'Medium', estimatedWeeks: 6, estimatedBudgetUsd: 12000,
    stack: ['Next.js'], deliverables: ['Build'], integrations: [], risks: [],
    clarificationQuestions: ['q1'],
    winProbability: { score: 68, reasons: ['fit'], improvements: ['x'] },
    recommendation: 'apply',
    fit: { portfolio: 80, skills: 85, budget: 80, competition: 'Medium' },
    expectedRoiUsdPerHour: 240,
    redFlags: ['none'],
  });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LlmService).useValue({
        analyzeJob: jest.fn().mockResolvedValue({
          text: ANALYSIS, provider: 'anthropic', model: 'claude-opus-4-8',
          promptTokens: 80, completionTokens: 200, costUsd: 0.0151, priceMapVersion: '2026-06-14',
        }),
      })
      .compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => { await app.close(); });

  const signup = async (email: string) => {
    await prisma.$executeRawUnsafe('TRUNCATE "QuotaPeriod","GenerationLog","Document","Profile","Membership","Job","Subscription","Org","User" RESTART IDENTITY CASCADE');
    const su = await request(app.getHttpServer()).post('/auth/signup').send({ email, password: 'pw1234567', name: 'A', agencyName: 'S', profession: 'developer' });
    return su.body.accessToken as string;
  };

  it('creates a Job from pasted text and returns the apply/don\'t-apply verdict', async () => {
    const t = await signup('assess@x.com');
    const res = await request(app.getHttpServer())
      .post('/jobs/assess').set({ Authorization: `Bearer ${t}` })
      .send({ text: 'Senior Next.js developer for a marketing site\nBudget around $12k, 6 weeks.' });
    expect(res.status).toBe(201);
    expect(res.body.job?.id).toBeTruthy();
    expect(res.body.job.title).toBe('Senior Next.js developer for a marketing site');
    expect(res.body.analysis.recommendation).toBe('apply');
    expect(res.body.analysis.fit.skills).toBe(85);
    expect(res.body.analysis.expectedRoiUsdPerHour).toBe(240);
    // persisted
    const job = await prisma.job.findFirst({ where: { id: res.body.job.id } });
    expect(job?.intelligenceJson).toBeTruthy();
  });

  it('rejects an empty paste with 400', async () => {
    const t = await signup('assess2@x.com');
    const res = await request(app.getHttpServer()).post('/jobs/assess').set({ Authorization: `Bearer ${t}` }).send({ text: '' });
    expect(res.status).toBe(400);
  });

  it('records an outcome and reflects Revenue Won in the analytics summary', async () => {
    const t = await signup('assess3@x.com');
    const job = await request(app.getHttpServer()).post('/jobs/assess').set({ Authorization: `Bearer ${t}` }).send({ text: 'Build a SaaS dashboard' });
    const jid = job.body.job.id;
    const patch = await request(app.getHttpServer()).patch(`/jobs/${jid}`).set({ Authorization: `Bearer ${t}` })
      .send({ status: 'won', wonAmountUsd: 9000, outcomeReason: 'short proposal, fixed price' });
    expect(patch.status).toBe(200);

    const summary = await request(app.getHttpServer()).get('/analytics/summary').set({ Authorization: `Bearer ${t}` });
    expect(summary.status).toBe(200);
    expect(summary.body.revenueWonUsd).toBe(9000);
    expect(summary.body.won).toBe(1);
    expect(summary.body.winRate).toBe(1);
    expect(summary.body.applications).toBe(1);
    expect(summary.body.revenuePerProposalUsd).toBe(9000);
  });
});
