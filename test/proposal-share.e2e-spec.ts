import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';
import { LlmService } from '../src/llm/llm.service';

const PROPOSAL = '{"summary":"Shareable summary","scope":["a"],"timelineWeeks":6,"priceUsd":24000,"closing":"Thanks"}';

describe('Proposal sharing (public link)', () => {
  let app: INestApplication; let prisma: PrismaService; let token: string; let jobId: string; let docId: string;
  const auth = () => ({ Authorization: `Bearer ${token}` });
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LlmService).useValue({
        generateProposal: jest.fn().mockResolvedValue({ text: PROPOSAL, provider: 'anthropic', model: 'm', promptTokens: 1, completionTokens: 1, costUsd: 0.01, priceMapVersion: 'v' }),
      }).compile();
    app = mod.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init(); prisma = app.get(PrismaService);
    await prisma.$executeRawUnsafe('TRUNCATE "DocumentVersion","QuotaPeriod","GenerationLog","Document","Profile","Membership","Job","Subscription","Org","User" RESTART IDENTITY CASCADE');
    const su = await request(app.getHttpServer()).post('/auth/signup').send({ email: 's@x.com', password: 'pw1234567', name: 'S', agencyName: 'BrandCo', profession: 'developer' });
    token = su.body.accessToken;
    const job = await request(app.getHttpServer()).post('/jobs').set(auth()).send({ title: 'Share Job' });
    jobId = job.body.id;
    const gen = await request(app.getHttpServer()).post(`/jobs/${jobId}/documents`).set(auth()).send({ type: 'proposal' });
    docId = gen.body.id;
  });
  afterAll(async () => { await app.close(); });

  let shareToken: string;

  it('creates a public share link (idempotent)', async () => {
    const res = await request(app.getHttpServer()).post(`/jobs/${jobId}/documents/${docId}/share`).set(auth());
    expect(res.status).toBe(201);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.url).toContain(`/${res.body.token}`);
    shareToken = res.body.token;
    // Calling again returns the same token.
    const again = await request(app.getHttpServer()).post(`/jobs/${jobId}/documents/${docId}/share`).set(auth());
    expect(again.body.token).toBe(shareToken);
  });

  it('serves the proposal publicly (no auth) with brand, without tenant internals', async () => {
    const res = await request(app.getHttpServer()).get(`/public/proposals/${shareToken}`); // no Authorization header
    expect(res.status).toBe(200);
    expect(res.body.title).toContain('Proposal');
    expect(res.body.contentJson.summary).toBe('Shareable summary');
    expect(res.body.brand.agencyName).toBe('BrandCo');
    // Never leak internals.
    expect(JSON.stringify(res.body)).not.toContain('orgId');
    expect(res.body.contentJson).toBeDefined();
    expect(res.body.brand.brandColor).toBeDefined();
  });

  it('returns 404 for an unknown token', async () => {
    const res = await request(app.getHttpServer()).get('/public/proposals/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('revoking the link makes it 404', async () => {
    const del = await request(app.getHttpServer()).delete(`/jobs/${jobId}/documents/${docId}/share`).set(auth());
    expect(del.status).toBe(200);
    const res = await request(app.getHttpServer()).get(`/public/proposals/${shareToken}`);
    expect(res.status).toBe(404);
  });
});
