import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';
import { LlmService } from '../src/llm/llm.service';

// T2.3 — server-rendered branded PDF. Drives the system Chrome (channel=chrome) so
// no Chromium download is needed locally; prod installs bundled Chromium in Docker.
describe('Proposal PDF export', () => {
  let app: INestApplication; let prisma: PrismaService; let token: string; let jobId: string; let docId: string; let tokenB: string;
  const prev = process.env.PLAYWRIGHT_CHROMIUM_CHANNEL;
  beforeAll(async () => {
    process.env.PLAYWRIGHT_CHROMIUM_CHANNEL = 'chrome';
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LlmService).useValue({
        generateProposal: jest.fn().mockResolvedValue({
          text: '{"summary":"A clear summary","scope":["Discovery","Build"],"timelineWeeks":8,"priceUsd":32000,"closing":"Let us begin"}',
          provider: 'anthropic', model: 'claude-opus-4-8', promptTokens: 10, completionTokens: 20, costUsd: 0.01, priceMapVersion: '2026-06-14',
        }),
      })
      .compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true })); app.useGlobalFilters(new AllExceptionsFilter());
    await app.init(); prisma = app.get(PrismaService);
    await prisma.$executeRawUnsafe('TRUNCATE "IdempotencyKey","QuotaPeriod","GenerationLog","DocumentVersion","Document","Profile","Membership","Job","Subscription","Org","User" RESTART IDENTITY CASCADE');
    const su = await request(app.getHttpServer()).post('/auth/signup').send({ email: 'pdf@x.com', password: 'pw1234567', name: 'P', agencyName: 'Pixel Studio', profession: 'developer' });
    token = su.body.accessToken;
    const b = await request(app.getHttpServer()).post('/auth/signup').send({ email: 'pdfb@x.com', password: 'pw1234567', name: 'B', agencyName: 'B', profession: 'developer' });
    tokenB = b.body.accessToken;
    const job = await request(app.getHttpServer()).post('/jobs').set({ Authorization: `Bearer ${token}` }).send({ title: 'Marketplace build' });
    jobId = job.body.id;
    const gen = await request(app.getHttpServer()).post(`/jobs/${jobId}/documents`).set({ Authorization: `Bearer ${token}` }).send({ type: 'proposal' });
    docId = gen.body.id;
  });
  afterAll(async () => {
    if (prev === undefined) delete process.env.PLAYWRIGHT_CHROMIUM_CHANNEL; else process.env.PLAYWRIGHT_CHROMIUM_CHANNEL = prev;
    await app.close();
  });

  const readPdf = (url: string, tok: string) =>
    request(app.getHttpServer()).get(url).set({ Authorization: `Bearer ${tok}` })
      .buffer().parse((res, cb) => { const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); });

  it('returns a branded PDF for the owner', async () => {
    const res = await readPdf(`/jobs/${jobId}/documents/${docId}/pdf`, token);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect((res.body as Buffer).length).toBeGreaterThan(1000);
  }, 30000);

  it('is tenant-scoped: another org gets 404', async () => {
    const res = await readPdf(`/jobs/${jobId}/documents/${docId}/pdf`, tokenB);
    expect(res.status).toBe(404);
  });
});
