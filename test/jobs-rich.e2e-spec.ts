import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { I18nValidationPipe } from 'nestjs-i18n';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';

// V1: rich Job data + the 7-stage pipeline status + PATCH update.
describe('Jobs — rich data + pipeline status', () => {
  let app: INestApplication; let prisma: PrismaService; let token: string;
  const auth = () => ({ Authorization: `Bearer ${token}` });
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new I18nValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init(); prisma = app.get(PrismaService);
    await prisma.$executeRawUnsafe('TRUNCATE "QuotaPeriod","GenerationLog","Document","Profile","Membership","Job","Subscription","Org","User" RESTART IDENTITY CASCADE');
    const su = await request(app.getHttpServer()).post('/auth/signup').send({ email: 'j@x.com', password: 'pw1234567', name: 'J', agencyName: 'S', profession: 'developer' });
    token = su.body.accessToken;
  });
  afterAll(async () => { await app.close(); });

  it('creates a job with rich client/opportunity fields and defaults to draft', async () => {
    const res = await request(app.getHttpServer()).post('/jobs').set(auth()).send({
      title: 'Acme Redesign', company: 'Acme',
      clientName: 'Jane Doe', clientEmail: 'jane@acme.com', clientWebsite: 'https://acme.com',
      projectDescription: 'Full website redesign', requirements: 'React, a11y', budget: 24000, timeline: '6 weeks',
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('draft');
    expect(res.body.clientName).toBe('Jane Doe');
    expect(res.body.budget).toBe(24000);
    expect(res.body.timeline).toBe('6 weeks');
  });

  it('rejects an invalid client email', async () => {
    const res = await request(app.getHttpServer()).post('/jobs').set(auth()).send({ title: 'Bad Email Job', clientEmail: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION');
  });

  it('PATCH updates fields and advances pipeline status', async () => {
    const created = await request(app.getHttpServer()).post('/jobs').set(auth()).send({ title: 'Pipeline Job' });
    const id = created.body.id;
    const res = await request(app.getHttpServer()).patch(`/jobs/${id}`).set(auth()).send({ status: 'negotiation', budget: 5000 });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('negotiation');
    expect(res.body.budget).toBe(5000);
  });

  it('rejects an out-of-enum status', async () => {
    const created = await request(app.getHttpServer()).post('/jobs').set(auth()).send({ title: 'Enum Job' });
    const res = await request(app.getHttpServer()).patch(`/jobs/${created.body.id}`).set(auth()).send({ status: 'active' });
    expect(res.status).toBe(400); // 'active' is no longer a valid JobStatus
  });

  it('PATCH is tenant-scoped (404 for another org\'s job)', async () => {
    const created = await request(app.getHttpServer()).post('/jobs').set(auth()).send({ title: 'Mine Only' });
    const other = await request(app.getHttpServer()).post('/auth/signup').send({ email: 'other@x.com', password: 'pw1234567', name: 'O', agencyName: 'S2', profession: 'designer' });
    const res = await request(app.getHttpServer()).patch(`/jobs/${created.body.id}`).set({ Authorization: `Bearer ${other.body.accessToken}` }).send({ status: 'won' });
    expect(res.status).toBe(404);
  });
});
