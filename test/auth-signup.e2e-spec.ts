import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Signup', () => {
  let app: INestApplication; let prisma: PrismaService;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE "Profile","Membership","Job","Document","Org","User" RESTART IDENTITY CASCADE');
  });
  afterAll(async () => { await app.close(); });

  it('creates user + org + owner membership + default profile, returns tokens', async () => {
    const res = await request(app.getHttpServer()).post('/auth/signup').send({
      email: 'a@x.com', password: 'pw1234567', name: 'Ana', agencyName: 'Studio A', profession: 'designer',
    });
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeDefined();
    const org = await prisma.org.findFirst({ include: { memberships: true, profile: true } });
    expect(org?.profession).toBe('designer');
    expect(org?.memberships[0].role).toBe('owner');
    expect(org?.profile?.agencyName).toBe('Studio A');
  });

  it('rejects a duplicate email with 400', async () => {
    const body = { email: 'a@x.com', password: 'pw1234567', name: 'Ana', agencyName: 'S', profession: 'developer' };
    await request(app.getHttpServer()).post('/auth/signup').send(body);
    const res = await request(app.getHttpServer()).post('/auth/signup').send(body);
    expect(res.status).toBe(400);
  });
});
