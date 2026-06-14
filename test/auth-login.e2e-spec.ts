import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Login', () => {
  let app: INestApplication; let prisma: PrismaService;
  const creds = { email: 'b@x.com', password: 'pw1234567', name: 'Bo', agencyName: 'S', profession: 'developer' };
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication(); app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init(); prisma = app.get(PrismaService);
    await prisma.$executeRawUnsafe('TRUNCATE "Profile","Membership","Job","Document","Org","User" RESTART IDENTITY CASCADE');
    await request(app.getHttpServer()).post('/auth/signup').send(creds);
  });
  afterAll(async () => { await app.close(); });

  it('logs in with correct password', async () => {
    const res = await request(app.getHttpServer()).post('/auth/login').send({ email: creds.email, password: creds.password });
    expect(res.status).toBe(201); expect(res.body.accessToken).toBeDefined();
  });
  it('rejects wrong password with 401 UNAUTHORIZED', async () => {
    const res = await request(app.getHttpServer()).post('/auth/login').send({ email: creds.email, password: 'wrong' });
    expect(res.status).toBe(401); expect(res.body.code).toBe('UNAUTHORIZED');
  });
});
