import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';

// H5: refresh tokens are now backed by a server-side store, so they rotate, can be
// hard-revoked (logout), and replay of a rotated token is detected as theft.
describe('Refresh token revocation + rotation', () => {
  let app: INestApplication; let prisma: PrismaService;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication(); app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true })); app.useGlobalFilters(new AllExceptionsFilter());
    await app.init(); prisma = app.get(PrismaService);
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE "RefreshToken","Profile","Membership","Job","Document","Org","User" RESTART IDENTITY CASCADE');
  });
  afterAll(async () => { await app.close(); });

  const signup = (email: string) =>
    request(app.getHttpServer()).post('/auth/signup').send({ email, password: 'pw1234567', name: 'U', agencyName: 'S', profession: 'developer' });

  it('rotates on refresh: the new cookie works, then the rotated-away one is dead', async () => {
    const su = await signup('rot@x.com');
    const c1 = su.headers['set-cookie'];

    const r1 = await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', c1);
    expect(r1.status).toBe(201);
    const c2 = r1.headers['set-cookie'];

    // New cookie refreshes (and rotates again to c3).
    const r2 = await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', c2);
    expect(r2.status).toBe(201);

    // Replaying the original rotated-away cookie is rejected (it was revoked on rotation).
    const reuse = await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', c1);
    expect(reuse.status).toBe(401);
  });

  it('reuse of a rotated token revokes the whole chain (theft response)', async () => {
    const su = await signup('theft@x.com');
    const c1 = su.headers['set-cookie'];
    const r1 = await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', c1);
    const c2 = r1.headers['set-cookie']; // current valid token

    // Attacker replays the old (revoked) c1 -> triggers chain revocation.
    const replay = await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', c1);
    expect(replay.status).toBe(401);

    // The legitimate current token c2 is now also dead.
    const legit = await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', c2);
    expect(legit.status).toBe(401);
    expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(0);
  });

  it('logout hard-revokes the refresh token', async () => {
    const su = await signup('out@x.com');
    const cookie = su.headers['set-cookie'];
    const out = await request(app.getHttpServer()).post('/auth/logout').set('Cookie', cookie);
    expect(out.status).toBe(201);
    const after = await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', cookie);
    expect(after.status).toBe(401);
  });
});
