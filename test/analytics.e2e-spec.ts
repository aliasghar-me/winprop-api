import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';

describe('Analytics summary (win rate)', () => {
  let app: INestApplication; let prisma: PrismaService; let token: string; let orgId: string;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true })); app.useGlobalFilters(new AllExceptionsFilter());
    await app.init(); prisma = app.get(PrismaService);
    await prisma.$executeRawUnsafe('TRUNCATE "QuotaPeriod","GenerationLog","DocumentVersion","Document","Profile","Membership","Job","Subscription","Org","User" RESTART IDENTITY CASCADE');
    const su = await request(app.getHttpServer()).post('/auth/signup').send({ email: 'an@x.com', password: 'pw1234567', name: 'A', agencyName: 'S', profession: 'developer' });
    token = su.body.accessToken;
    orgId = (await prisma.org.findFirst())!.id; // exactly one org after truncate + signup
    // 3 won, 1 lost, 2 draft → winRate = 3/4 = 0.75
    const mk = (status: string, i: number) => prisma.job.create({ data: { orgId, title: `${status}-${i}`, company: '—', status: status as never } });
    await Promise.all([mk('won', 1), mk('won', 2), mk('won', 3), mk('lost', 1), mk('draft', 1), mk('draft', 2)]);
  });
  afterAll(async () => { await app.close(); });

  it('computes win rate and status breakdown, tenant-scoped', async () => {
    const res = await request(app.getHttpServer()).get('/analytics/summary').set({ Authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(6);
    expect(res.body.won).toBe(3);
    expect(res.body.lost).toBe(1);
    expect(res.body.winRate).toBe(0.75);
    expect(res.body.byStatus.draft).toBe(2);
  });

  it('returns null win rate before any deal is decided', async () => {
    const su = await request(app.getHttpServer()).post('/auth/signup').send({ email: 'an2@x.com', password: 'pw1234567', name: 'B', agencyName: 'S2', profession: 'developer' });
    const res = await request(app.getHttpServer()).get('/analytics/summary').set({ Authorization: `Bearer ${su.body.accessToken}` });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.winRate).toBeNull();
  });
});
