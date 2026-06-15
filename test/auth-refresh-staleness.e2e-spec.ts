import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';

describe('Refresh re-reads current membership', () => {
  let app: INestApplication; let prisma: PrismaService;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication(); app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true })); app.useGlobalFilters(new AllExceptionsFilter());
    await app.init(); prisma = app.get(PrismaService);
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE "Profile","Membership","Job","Document","Org","User" RESTART IDENTITY CASCADE');
  });
  afterAll(async () => { await app.close(); });

  it('demotion to viewer takes effect on next refresh (new token cannot create jobs)', async () => {
    const su = await request(app.getHttpServer()).post('/auth/signup').send({ email: 'd@x.com', password: 'pw1234567', name: 'D', agencyName: 'S', profession: 'developer' });
    const ownerToken = su.body.accessToken;
    const cookie = su.headers['set-cookie'];
    // owner can create
    expect((await request(app.getHttpServer()).post('/jobs').set({ Authorization: `Bearer ${ownerToken}` }).send({ title: 'J1' })).status).toBe(201);
    // demote in DB
    const org = await prisma.org.findFirst();
    await prisma.membership.updateMany({ where: { orgId: org!.id }, data: { role: 'viewer' } });
    // refresh -> new token should carry viewer role
    const refreshed = await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', cookie);
    expect(refreshed.status).toBe(201);
    const viewerToken = refreshed.body.accessToken;
    // viewer cannot create
    const denied = await request(app.getHttpServer()).post('/jobs').set({ Authorization: `Bearer ${viewerToken}` }).send({ title: 'J2' });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('FORBIDDEN');
  });

  it('removed membership => refresh is rejected 401', async () => {
    const su = await request(app.getHttpServer()).post('/auth/signup').send({ email: 'r@x.com', password: 'pw1234567', name: 'R', agencyName: 'S', profession: 'developer' });
    const cookie = su.headers['set-cookie'];
    await prisma.membership.deleteMany({});
    const refreshed = await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', cookie);
    expect(refreshed.status).toBe(401);
  });
});
