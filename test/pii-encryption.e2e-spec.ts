import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';

// User email + name must be ciphertext at rest; lookups go through the emailHash
// blind index, so signup dedup and login still work (security #16).
describe('PII encryption at rest', () => {
  let app: INestApplication; let prisma: PrismaService;
  const EMAIL = 'pii@example.com'; const NAME = 'Pat Privacy';
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true })); app.useGlobalFilters(new AllExceptionsFilter());
    await app.init(); prisma = app.get(PrismaService);
    await prisma.$executeRawUnsafe('TRUNCATE "EmailVerificationToken","QuotaPeriod","GenerationLog","Document","Profile","Membership","Job","Subscription","Org","User" RESTART IDENTITY CASCADE');
  });
  afterAll(async () => { await app.close(); });

  it('stores email/name encrypted, dedups signup, and logs in via the blind index', async () => {
    const su = await request(app.getHttpServer()).post('/auth/signup').send({ email: EMAIL, password: 'pw1234567', name: NAME, agencyName: 'S', profession: 'developer' });
    expect(su.status).toBe(201);

    // At rest: neither the email nor the name appears in cleartext; emailHash is set.
    const row = await prisma.user.findFirst();
    expect(row?.email).not.toBe(EMAIL);
    expect(row?.email).toContain(':'); // iv:tag:data ciphertext shape
    expect(row?.name).not.toBe(NAME);
    expect(row?.emailHash).toBeTruthy();
    expect(row?.emailHash).not.toContain(EMAIL);

    // Duplicate signup is still rejected (dedup via emailHash).
    const dup = await request(app.getHttpServer()).post('/auth/signup').send({ email: EMAIL, password: 'pw1234567', name: 'Other', agencyName: 'S2', profession: 'developer' });
    expect(dup.status).toBe(400);

    // Login works through the blind index.
    const login = await request(app.getHttpServer()).post('/auth/login').send({ email: EMAIL, password: 'pw1234567' });
    expect(login.status).toBe(201);
    expect(typeof login.body.accessToken).toBe('string');

    // GET /me decrypts for display.
    const me = await request(app.getHttpServer()).get('/me').set({ Authorization: `Bearer ${login.body.accessToken}` });
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(EMAIL);
    expect(me.body.name).toBe(NAME);
  });
});
