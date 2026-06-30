import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { createHmac } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';

// Generate a current TOTP code from a base32 secret (independent of the impl under test).
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function totpNow(secret: string): string {
  let bits = 0, value = 0; const bytes: number[] = [];
  for (const ch of secret.toUpperCase()) { const i = ALPHABET.indexOf(ch); if (i === -1) continue; value = (value << 5) | i; bits += 5; if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 0xff); bits -= 8; } }
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const d = createHmac('sha1', Buffer.from(bytes)).update(buf).digest();
  const o = d[d.length - 1] & 0x0f;
  const bin = ((d[o] & 0x7f) << 24) | ((d[o + 1] & 0xff) << 16) | ((d[o + 2] & 0xff) << 8) | (d[o + 3] & 0xff);
  return (bin % 1_000_000).toString().padStart(6, '0');
}

describe('Super-admin MFA (TOTP)', () => {
  let app: INestApplication; let prisma: PrismaService; let token: string;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true })); app.useGlobalFilters(new AllExceptionsFilter());
    await app.init(); prisma = app.get(PrismaService);
    await prisma.$executeRawUnsafe('TRUNCATE "SuperAdminAuditLog","LlmConfig","SuperAdmin" RESTART IDENTITY CASCADE');
    await prisma.superAdmin.create({ data: { email: 'root@winprop.ai', passwordHash: await bcrypt.hash('s3cret-pw', 10) } });
    token = (await request(app.getHttpServer()).post('/admin/login').send({ email: 'root@winprop.ai', password: 's3cret-pw' })).body.token;
  });
  afterAll(async () => { await app.close(); });

  it('enrolls, confirms, then requires a valid TOTP code at login', async () => {
    const enroll = await request(app.getHttpServer()).post('/admin/mfa/enroll').set({ Authorization: `Bearer ${token}` });
    expect(enroll.status).toBe(201);
    expect(enroll.body.otpauthUrl).toContain('otpauth://totp/');
    const secret = enroll.body.secret as string;

    // The secret is encrypted at rest, never stored in cleartext.
    const row = await prisma.superAdmin.findUnique({ where: { email: 'root@winprop.ai' } });
    expect(row?.totpSecret).toBeTruthy();
    expect(row?.totpSecret).not.toContain(secret);
    expect(row?.totpEnabledAt).toBeNull(); // pending until confirmed

    // Wrong confirm code is rejected.
    const badConfirm = await request(app.getHttpServer()).post('/admin/mfa/confirm').set({ Authorization: `Bearer ${token}` }).send({ code: '000000' });
    expect(badConfirm.status).toBe(400);

    // Correct code enables MFA.
    const confirm = await request(app.getHttpServer()).post('/admin/mfa/confirm').set({ Authorization: `Bearer ${token}` }).send({ code: totpNow(secret) });
    expect(confirm.status).toBe(201);

    // Login without a code now fails with MFA_REQUIRED.
    const noCode = await request(app.getHttpServer()).post('/admin/login').send({ email: 'root@winprop.ai', password: 's3cret-pw' });
    expect(noCode.status).toBe(401);
    expect(noCode.body.code).toBe('MFA_REQUIRED');

    // Wrong code fails with a neutral 401.
    const wrong = await request(app.getHttpServer()).post('/admin/login').send({ email: 'root@winprop.ai', password: 's3cret-pw', totpCode: '123456' });
    expect(wrong.status).toBe(401);

    // Correct password + code succeeds.
    const ok = await request(app.getHttpServer()).post('/admin/login').send({ email: 'root@winprop.ai', password: 's3cret-pw', totpCode: totpNow(secret) });
    expect(ok.status).toBe(201);
    expect(typeof ok.body.token).toBe('string');
  });
});
