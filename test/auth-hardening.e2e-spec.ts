import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';

describe('Auth hardening (lockout, logout-all, origin)', () => {
  let app: INestApplication; let prisma: PrismaService;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication(); app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true })); app.useGlobalFilters(new AllExceptionsFilter());
    await app.init(); prisma = app.get(PrismaService);
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE "RefreshToken","Profile","Membership","Job","Org","User" RESTART IDENTITY CASCADE');
  });
  afterAll(async () => { await app.close(); });

  const signup = (email: string) =>
    request(app.getHttpServer()).post('/auth/signup').send({ email, password: 'pw1234567', name: 'U', agencyName: 'S', profession: 'developer' });

  it('locks the account after repeated failed logins', async () => {
    await signup('lock@x.com');
    for (let i = 0; i < 10; i++) {
      await request(app.getHttpServer()).post('/auth/login').send({ email: 'lock@x.com', password: 'wrong-pw' });
    }
    const user = await prisma.user.findFirst(); // single user after truncate (email is now ciphertext, not a lookup key)
    expect(user?.lockedUntil).not.toBeNull();
    // even the CORRECT password is refused while locked
    const res = await request(app.getHttpServer()).post('/auth/login').send({ email: 'lock@x.com', password: 'pw1234567' });
    expect(res.status).toBe(401);
  });

  it('logout-all revokes every refresh token', async () => {
    const su = await signup('all@x.com');
    const token = su.body.accessToken; const cookie = su.headers['set-cookie'];
    const out = await request(app.getHttpServer()).post('/auth/logout-all').set({ Authorization: `Bearer ${token}` });
    expect(out.status).toBe(201);
    const after = await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', cookie);
    expect(after.status).toBe(401);
  });

  it('rejects refresh from a disallowed Origin, allows the configured one', async () => {
    const su = await signup('org@x.com');
    const cookie = su.headers['set-cookie'];
    const evil = await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', cookie).set('Origin', 'https://evil.example');
    expect(evil.status).toBe(403);
    const ok = await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', cookie).set('Origin', process.env.WEB_ORIGIN || 'http://localhost:3000');
    expect(ok.status).toBe(201);
  });
});
