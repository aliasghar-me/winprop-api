import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';

async function signup(app: INestApplication, email: string) {
  const res = await request(app.getHttpServer()).post('/auth/signup')
    .send({ email, password: 'pw1234567', name: 'U', agencyName: 'S', profession: 'developer' });
  return res.body.accessToken as string;
}

describe('Jobs', () => {
  let app: INestApplication; let prisma: PrismaService; let token: string;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init(); prisma = app.get(PrismaService);
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE "Profile","Membership","Job","Document","Org","User" RESTART IDENTITY CASCADE');
    token = await signup(app, 'owner@x.com');
  });
  afterAll(async () => { await app.close(); });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('creates and lists a job', async () => {
    const c = await request(app.getHttpServer()).post('/jobs').set(auth()).send({ title: 'Acme Marketplace' });
    expect(c.status).toBe(201);
    const l = await request(app.getHttpServer()).get('/jobs').set(auth());
    expect(l.body.length).toBe(1);
    expect(l.body[0].title).toBe('Acme Marketplace');
  });

  it('rejects a case/space-duplicate name with 409 DUPLICATE_NAME', async () => {
    await request(app.getHttpServer()).post('/jobs').set(auth()).send({ title: 'Acme Marketplace' });
    const dup = await request(app.getHttpServer()).post('/jobs').set(auth()).send({ title: '  acme   marketplace ' });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('DUPLICATE_NAME');
  });

  it('requires auth', async () => {
    const res = await request(app.getHttpServer()).get('/jobs');
    expect(res.status).toBe(401);
  });
});
