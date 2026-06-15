import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Refresh', () => {
  let app: INestApplication; let prisma: PrismaService;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication(); app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init(); prisma = app.get(PrismaService);
    await prisma.$executeRawUnsafe('TRUNCATE "Profile","Membership","Org","User" RESTART IDENTITY CASCADE');
  });
  afterAll(async () => { await app.close(); });

  it('issues a new access token from the refresh cookie', async () => {
    const su = await request(app.getHttpServer()).post('/auth/signup').send({ email: 'o@x.com', password: 'pw1234567', name: 'O', agencyName: 'S', profession: 'developer' });
    const cookie = su.headers['set-cookie'];
    expect(cookie).toBeDefined();
    const res = await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', cookie);
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeDefined();
  });
});
