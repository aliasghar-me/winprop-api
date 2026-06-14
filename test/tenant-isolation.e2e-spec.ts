import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';

async function signup(app: INestApplication, email: string) {
  const r = await request(app.getHttpServer()).post('/auth/signup')
    .send({ email, password: 'pw1234567', name: 'U', agencyName: 'S', profession: 'developer' });
  return r.body.accessToken as string;
}
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('Cross-tenant isolation (keystone)', () => {
  let app: INestApplication; let prisma: PrismaService;
  let tokenA: string; let tokenB: string;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init(); prisma = app.get(PrismaService);
    await prisma.$executeRawUnsafe('TRUNCATE "Profile","Membership","Job","Document","Org","User" RESTART IDENTITY CASCADE');
    tokenA = await signup(app, 'a@x.com');
    tokenB = await signup(app, 'b@x.com');
  });
  afterAll(async () => { await app.close(); });

  it('org B does not see org A jobs, and vice versa', async () => {
    await request(app.getHttpServer()).post('/jobs').set(bearer(tokenA)).send({ title: 'A-Secret-1' });
    await request(app.getHttpServer()).post('/jobs').set(bearer(tokenA)).send({ title: 'A-Secret-2' });
    await request(app.getHttpServer()).post('/jobs').set(bearer(tokenB)).send({ title: 'B-Only-1' });

    const listB = await request(app.getHttpServer()).get('/jobs').set(bearer(tokenB));
    const titlesB = (listB.body as any[]).map((j) => j.title);
    expect(titlesB).toEqual(['B-Only-1']);            // B sees ONLY its own
    expect(titlesB).not.toContain('A-Secret-1');
    expect(titlesB).not.toContain('A-Secret-2');

    const listA = await request(app.getHttpServer()).get('/jobs').set(bearer(tokenA));
    const titlesA = (listA.body as any[]).map((j) => j.title).sort();
    expect(titlesA).toEqual(['A-Secret-1', 'A-Secret-2']); // A sees ONLY its own
    expect(titlesA).not.toContain('B-Only-1');
  });

  it('the same job title is allowed across different orgs (uniqueness is per-org, not global)', async () => {
    // A already has 'A-Secret-1'; B creating 'A-Secret-1' must SUCCEED (different tenant).
    const res = await request(app.getHttpServer()).post('/jobs').set(bearer(tokenB)).send({ title: 'A-Secret-1' });
    expect(res.status).toBe(201);
  });
});
