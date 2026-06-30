import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';
import { tenantStorage, runUnscoped } from '../src/common/tenant/tenant-context';

// Proves the Prisma tenant extension (enforce mode) scopes tenant models on its own —
// independent of the manual where:{orgId} layer — and fails closed without context.
describe('Tenant Prisma extension (enforce mode)', () => {
  let app: INestApplication; let prisma: PrismaService;
  let orgA = ''; let orgB = ''; let tokenB = ''; let jobA = '';
  const prev = process.env.TENANT_EXTENSION_MODE;

  beforeAll(async () => {
    process.env.TENANT_EXTENSION_MODE = 'enforce';
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true })); app.useGlobalFilters(new AllExceptionsFilter());
    await app.init(); prisma = app.get(PrismaService);
    await prisma.$executeRawUnsafe('TRUNCATE "QuotaPeriod","GenerationLog","DocumentVersion","Document","Profile","Membership","Job","Subscription","Org","User" RESTART IDENTITY CASCADE');
    const a = await request(app.getHttpServer()).post('/auth/signup').send({ email: 'a@x.com', password: 'pw1234567', name: 'A', agencyName: 'A', profession: 'developer' });
    const b = await request(app.getHttpServer()).post('/auth/signup').send({ email: 'b@x.com', password: 'pw1234567', name: 'B', agencyName: 'B', profession: 'developer' });
    tokenB = b.body.accessToken;
    const ja = await request(app.getHttpServer()).post('/jobs').set({ Authorization: `Bearer ${a.body.accessToken}` }).send({ title: 'A job' });
    await request(app.getHttpServer()).post('/jobs').set({ Authorization: `Bearer ${tokenB}` }).send({ title: 'B job' });
    jobA = ja.body.id;
    const jobs = await prisma.job.findMany(); // base client (no store) → all rows
    orgA = jobs.find((j) => j.title === 'A job')!.orgId;
    orgB = jobs.find((j) => j.title === 'B job')!.orgId;
  });
  afterAll(async () => {
    if (prev === undefined) delete process.env.TENANT_EXTENSION_MODE; else process.env.TENANT_EXTENSION_MODE = prev;
    await app.close();
  });

  // Note: await INSIDE run() so the lazy Prisma query executes within the ALS context.
  it('scopes a no-where findMany to the ambient org (extension, not manual code)', async () => {
    const aJobs = await tenantStorage.run({ orgId: orgA, bypass: false }, async () => await prisma.db.job.findMany({}));
    expect(aJobs.length).toBe(1);
    expect(aJobs.every((j) => j.orgId === orgA)).toBe(true);

    const bJobs = await tenantStorage.run({ orgId: orgB, bypass: false }, async () => await prisma.db.job.findMany({}));
    expect(bJobs.length).toBe(1);
    expect(bJobs[0].title).toBe('B job');
  });

  it('fails closed when a tenant model is queried with no org in context', async () => {
    await expect(
      tenantStorage.run({ bypass: false }, async () => await prisma.db.job.findMany({})),
    ).rejects.toBeDefined();
  });

  it('passes through under runUnscoped (background/cross-tenant work)', async () => {
    const all = await runUnscoped(async () => await prisma.db.job.findMany({}));
    expect(all.length).toBe(2);
  });

  it('HTTP: org B cannot read org A’s job by id', async () => {
    const res = await request(app.getHttpServer()).get(`/jobs/${jobA}`).set({ Authorization: `Bearer ${tokenB}` });
    expect(res.status).toBe(404);
  });
});
