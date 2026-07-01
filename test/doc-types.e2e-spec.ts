import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';
import { LlmService } from '../src/llm/llm.service';

const SOW = { overview: 'Overview', deliverables: ['D1', 'D2'], milestones: ['M1'], assumptions: ['A1'], timelineWeeks: 8, priceUsd: 20000 };
const EST = { summary: 'Est summary', lineItems: ['Item — $5k'], timelineWeeks: 6, priceUsd: 15000, notes: 'Valid 30 days' };

describe('Document types (SOW / estimate)', () => {
  let app: INestApplication; let prisma: PrismaService; let token: string; let jobId: string;
  const prevChannel = process.env.PLAYWRIGHT_CHROMIUM_CHANNEL;
  beforeAll(async () => {
    process.env.PLAYWRIGHT_CHROMIUM_CHANNEL = 'chrome';
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LlmService).useValue({
        generateDoc: jest.fn(async (_p: unknown, _j: unknown, type: string) => ({
          text: JSON.stringify(type === 'sow' ? SOW : EST),
          provider: 'anthropic', model: 'claude-opus-4-8', promptTokens: 10, completionTokens: 20, costUsd: 0.01, priceMapVersion: '2026-06-14',
        })),
        regenerateDocField: jest.fn(async () => ({
          key: 'overview', value: 'Regenerated overview',
          provider: 'anthropic', model: 'claude-opus-4-8', promptTokens: 5, completionTokens: 8, costUsd: 0.005, priceMapVersion: '2026-06-14',
        })),
      })
      .compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true })); app.useGlobalFilters(new AllExceptionsFilter());
    await app.init(); prisma = app.get(PrismaService);
    await prisma.$executeRawUnsafe('TRUNCATE "IdempotencyKey","QuotaPeriod","GenerationLog","DocumentVersion","Document","Profile","Membership","Job","Subscription","Org","User" RESTART IDENTITY CASCADE');
    const su = await request(app.getHttpServer()).post('/auth/signup').send({ email: 'dt@x.com', password: 'pw1234567', name: 'D', agencyName: 'S', profession: 'developer' });
    token = su.body.accessToken;
    await prisma.org.updateMany({ data: { plan: 'professional' } }); // ample quota for several generations
    const job = await request(app.getHttpServer()).post('/jobs').set({ Authorization: `Bearer ${token}` }).send({ title: 'DT Job' });
    jobId = job.body.id;
  });
  afterAll(async () => {
    if (prevChannel === undefined) delete process.env.PLAYWRIGHT_CHROMIUM_CHANNEL; else process.env.PLAYWRIGHT_CHROMIUM_CHANNEL = prevChannel;
    await app.close();
  });
  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('generates a SOW and an estimate as typed documents', async () => {
    const sow = await request(app.getHttpServer()).post(`/jobs/${jobId}/documents`).set(auth()).send({ type: 'sow' });
    expect(sow.status).toBe(201);
    expect(sow.body.type).toBe('sow');
    expect(sow.body.title).toContain('SOW');
    expect(sow.body.contentJson.deliverables).toEqual(['D1', 'D2']);

    const est = await request(app.getHttpServer()).post(`/jobs/${jobId}/documents`).set(auth()).send({ type: 'estimate' });
    expect(est.status).toBe(201);
    expect(est.body.type).toBe('estimate');
    expect(est.body.contentJson.priceUsd).toBe(15000);
  });

  it('regenerates a SOW field via the registry', async () => {
    const sow = await request(app.getHttpServer()).post(`/jobs/${jobId}/documents`).set(auth()).send({ type: 'sow' });
    const res = await request(app.getHttpServer()).post(`/jobs/${jobId}/documents/${sow.body.id}/regenerate-section`).set(auth()).send({ section: 'overview' });
    expect(res.status).toBe(201);
    expect(res.body.value).toBe('Regenerated overview');
  });

  it('rejects an unknown document type', async () => {
    const res = await request(app.getHttpServer()).post(`/jobs/${jobId}/documents`).set(auth()).send({ type: 'contract' });
    expect(res.status).toBe(400);
  });

  it('exports a SOW to PDF', async () => {
    const sow = await request(app.getHttpServer()).post(`/jobs/${jobId}/documents`).set(auth()).send({ type: 'sow' });
    const res = await request(app.getHttpServer()).get(`/jobs/${jobId}/documents/${sow.body.id}/pdf`).set(auth())
      .buffer().parse((r, cb) => { const c: Buffer[] = []; r.on('data', (x: Buffer) => c.push(x)); r.on('end', () => cb(null, Buffer.concat(c))); });
    expect(res.status).toBe(200);
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  }, 30000);
});
