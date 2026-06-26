import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { I18nValidationPipe } from 'nestjs-i18n';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';
import { LlmService } from '../src/llm/llm.service';

const PROPOSAL = '{"summary":"Original summary","scope":["a"],"timelineWeeks":6,"priceUsd":24000,"closing":"Thanks"}';

describe('Documents — editor (update, versions, regenerate-section)', () => {
  let app: INestApplication; let prisma: PrismaService; let token: string; let jobId: string; let docId: string;
  const auth = () => ({ Authorization: `Bearer ${token}` });
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LlmService).useValue({
        generateProposal: jest.fn().mockResolvedValue({
          text: PROPOSAL, provider: 'anthropic', model: 'm', promptTokens: 100, completionTokens: 300, costUsd: 0.02, priceMapVersion: 'v',
        }),
        regenerateSection: jest.fn().mockResolvedValue({
          key: 'summary', value: 'Regenerated summary', provider: 'anthropic', model: 'm', promptTokens: 20, completionTokens: 40, costUsd: 0.002, priceMapVersion: 'v',
        }),
      }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new I18nValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init(); prisma = app.get(PrismaService);
    await prisma.$executeRawUnsafe('TRUNCATE "DocumentVersion","QuotaPeriod","GenerationLog","Document","Profile","Membership","Job","Subscription","Org","User" RESTART IDENTITY CASCADE');
    const su = await request(app.getHttpServer()).post('/auth/signup').send({ email: 'e@x.com', password: 'pw1234567', name: 'E', agencyName: 'S', profession: 'developer' });
    token = su.body.accessToken;
    const job = await request(app.getHttpServer()).post('/jobs').set(auth()).send({ title: 'Editor Job' });
    jobId = job.body.id;
    const gen = await request(app.getHttpServer()).post(`/jobs/${jobId}/documents`).set(auth()).send({ type: 'proposal' });
    docId = gen.body.id;
    expect(gen.body.version).toBe(1);
  });
  afterAll(async () => { await app.close(); });

  it('editing content bumps the version and snapshots the previous one', async () => {
    const edited = { summary: 'Edited summary', scope: ['a', 'b'], timelineWeeks: 8, priceUsd: 30000, closing: 'Thanks' };
    const res = await request(app.getHttpServer()).patch(`/jobs/${jobId}/documents/${docId}`).set(auth()).send({ contentJson: edited });
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(2);
    expect(res.body.contentJson.summary).toBe('Edited summary');

    const versions = await request(app.getHttpServer()).get(`/jobs/${jobId}/documents/${docId}/versions`).set(auth());
    expect(versions.body).toHaveLength(1);
    expect(versions.body[0].version).toBe(1);
    expect(versions.body[0].contentJson.summary).toBe('Original summary'); // the pre-edit snapshot
  });

  it('title-only change does NOT create a new version', async () => {
    const before = await request(app.getHttpServer()).get(`/jobs/${jobId}/documents/${docId}`).set(auth());
    const res = await request(app.getHttpServer()).patch(`/jobs/${jobId}/documents/${docId}`).set(auth()).send({ title: 'Renamed' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Renamed');
    expect(res.body.version).toBe(before.body.version); // unchanged
    const versions = await request(app.getHttpServer()).get(`/jobs/${jobId}/documents/${docId}/versions`).set(auth());
    expect(versions.body).toHaveLength(1); // still just the one content snapshot
  });

  it('regenerates a single section and returns the suggested value', async () => {
    const res = await request(app.getHttpServer()).post(`/jobs/${jobId}/documents/${docId}/regenerate-section`).set(auth()).send({ section: 'summary' });
    expect(res.status).toBe(201);
    expect(res.body.key).toBe('summary');
    expect(res.body.value).toBe('Regenerated summary');
  });

  it('rejects an unknown section', async () => {
    const res = await request(app.getHttpServer()).post(`/jobs/${jobId}/documents/${docId}/regenerate-section`).set(auth()).send({ section: 'banana' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION');
  });

  it('is tenant-scoped (404 editing another org\'s document)', async () => {
    const other = await request(app.getHttpServer()).post('/auth/signup').send({ email: 'e2@x.com', password: 'pw1234567', name: 'E2', agencyName: 'S2', profession: 'designer' });
    const res = await request(app.getHttpServer()).patch(`/jobs/${jobId}/documents/${docId}`).set({ Authorization: `Bearer ${other.body.accessToken}` }).send({ title: 'hax' });
    expect(res.status).toBe(404);
  });
});
