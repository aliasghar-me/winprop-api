import * as bcrypt from 'bcrypt';
import { createHmac } from 'crypto';
import { AdminService } from '../src/admin/admin.service';
import { SuperAdminService } from '../src/admin/super-admin.service';
import { generateBase32Secret, otpauthUrl, verifyTotp } from '../src/admin/totp.util';

// Unit tests only — hand-rolled fakes for PrismaService / JwtService / CryptoService.
// A separate signing secret keeps super-admin tokens off the user JWT secret; set
// it before constructing (the fake JwtService ignores it, but this documents intent).
process.env.SUPER_ADMIN_JWT_SECRET = 'super-secret-for-tests';
process.env.JWT_SECRET = 'user-secret-for-tests';

const PASSWORD = 'admin-pass';
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 12);

// Produce the current valid 6-digit TOTP code for a base32 secret, mirroring the
// implementation under test (RFC 6238, SHA-1, 30s step) — this exercises the REAL
// verifyTotp path rather than mocking it.
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Decode(str: string): Buffer {
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of str.replace(/=+$/, '').toUpperCase()) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
function currentTotp(secret: string): string {
  const counter = Math.floor(Date.now() / 1000 / 30);
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', key).update(buf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const bin = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
  return (bin % 1_000_000).toString().padStart(6, '0');
}

const crypto: any = {
  encrypt: jest.fn((v: string) => `enc(${v})`),
  decrypt: jest.fn((v: string) => v.replace(/^enc\(|\)$/g, '')),
};

// -------------------- AdminService (global LLM config) --------------------

describe('AdminService', () => {
  function makePrisma(over: any = {}) {
    return {
      llmConfig: { findFirst: jest.fn(), update: jest.fn().mockResolvedValue({}), create: jest.fn().mockResolvedValue({}) },
      org: { findMany: jest.fn().mockResolvedValue([{ id: 'o1', name: 'ACME', profession: 'developer', plan: 'free' }]) },
      ...over,
    } as any;
  }
  const dto: any = { provider: 'anthropic', model: 'claude-opus-4-8', apiKey: 'sk-123' };

  it('setGlobalLlm updates the existing global row', async () => {
    const prisma = makePrisma();
    prisma.llmConfig.findFirst.mockResolvedValue({ id: 'cfg1' });
    const svc = new AdminService(prisma, crypto);
    expect(await svc.setGlobalLlm(dto)).toEqual({ ok: true });
    expect(crypto.encrypt).toHaveBeenCalledWith('sk-123');
    expect(prisma.llmConfig.update).toHaveBeenCalledWith({ where: { id: 'cfg1' }, data: { provider: 'anthropic', model: 'claude-opus-4-8', apiKeyEncrypted: 'enc(sk-123)' } });
    expect(prisma.llmConfig.create).not.toHaveBeenCalled();
  });

  it('setGlobalLlm creates the row when none exists', async () => {
    const prisma = makePrisma();
    prisma.llmConfig.findFirst.mockResolvedValue(null);
    const svc = new AdminService(prisma, crypto);
    await svc.setGlobalLlm(dto);
    expect(prisma.llmConfig.create).toHaveBeenCalledWith({ data: { orgId: null, provider: 'anthropic', model: 'claude-opus-4-8', apiKeyEncrypted: 'enc(sk-123)' } });
    expect(prisma.llmConfig.update).not.toHaveBeenCalled();
  });

  it('getGlobalLlmStatus reports a configured row', async () => {
    const prisma = makePrisma();
    const updatedAt = new Date();
    prisma.llmConfig.findFirst.mockResolvedValue({ provider: 'anthropic', model: 'claude-opus-4-8', updatedAt });
    const svc = new AdminService(prisma, crypto);
    expect(await svc.getGlobalLlmStatus()).toEqual({ isSet: true, provider: 'anthropic', model: 'claude-opus-4-8', updatedAt });
  });

  it('getGlobalLlmStatus reports an unset config', async () => {
    const prisma = makePrisma();
    prisma.llmConfig.findFirst.mockResolvedValue(null);
    const svc = new AdminService(prisma, crypto);
    expect(await svc.getGlobalLlmStatus()).toEqual({ isSet: false, provider: null, model: null, updatedAt: null });
  });

  it('getGlobalLlmStatus coalesces null fields on a present row', async () => {
    const prisma = makePrisma();
    prisma.llmConfig.findFirst.mockResolvedValue({ provider: null, model: null, updatedAt: null });
    const svc = new AdminService(prisma, crypto);
    expect(await svc.getGlobalLlmStatus()).toEqual({ isSet: true, provider: null, model: null, updatedAt: null });
  });

  it('listOrgs delegates to prisma with a projection', () => {
    const prisma = makePrisma();
    const svc = new AdminService(prisma, crypto);
    svc.listOrgs();
    expect(prisma.org.findMany).toHaveBeenCalledWith({ select: { id: true, name: true, profession: true, plan: true } });
  });
});

// -------------------- SuperAdminService (login + MFA + audit) --------------------

describe('SuperAdminService', () => {
  function makePrisma(over: any = {}) {
    return {
      superAdmin: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      superAdminAuditLog: { create: jest.fn().mockResolvedValue({}) },
      ...over,
    } as any;
  }
  const jwt: any = { sign: jest.fn(() => 'super.jwt') };

  const enrolledSecret = generateBase32Secret();
  const baseAdmin = { id: 'sa1', email: 'boss@winprop.ai', passwordHash: PASSWORD_HASH, totpEnabledAt: null, totpSecret: null };

  describe('login', () => {
    it('rejects an unknown admin', async () => {
      const prisma = makePrisma();
      prisma.superAdmin.findUnique.mockResolvedValue(null);
      const svc = new SuperAdminService(prisma, jwt, crypto);
      await expect(svc.login('x@x.com', PASSWORD)).rejects.toMatchObject({ code: 'UNAUTHORIZED', translationKey: 'errors.invalidCredentials' });
    });

    it('rejects an admin with no password hash', async () => {
      const prisma = makePrisma();
      prisma.superAdmin.findUnique.mockResolvedValue({ ...baseAdmin, passwordHash: null });
      const svc = new SuperAdminService(prisma, jwt, crypto);
      await expect(svc.login(baseAdmin.email, PASSWORD)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });

    it('rejects a wrong password', async () => {
      const prisma = makePrisma();
      prisma.superAdmin.findUnique.mockResolvedValue({ ...baseAdmin });
      const svc = new SuperAdminService(prisma, jwt, crypto);
      await expect(svc.login(baseAdmin.email, 'wrong')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });

    it('issues a token when MFA is not enrolled', async () => {
      const prisma = makePrisma();
      prisma.superAdmin.findUnique.mockResolvedValue({ ...baseAdmin });
      const svc = new SuperAdminService(prisma, jwt, crypto);
      expect(await svc.login(baseAdmin.email, PASSWORD)).toEqual({ token: 'super.jwt' });
      expect(jwt.sign).toHaveBeenCalledWith({ sub: 'sa1', email: baseAdmin.email, scope: 'super-admin' }, expect.objectContaining({ algorithm: 'HS256' }));
    });

    it('requires a TOTP code once MFA is enrolled', async () => {
      const prisma = makePrisma();
      prisma.superAdmin.findUnique.mockResolvedValue({ ...baseAdmin, totpEnabledAt: new Date(), totpSecret: `enc(${enrolledSecret})` });
      const svc = new SuperAdminService(prisma, jwt, crypto);
      await expect(svc.login(baseAdmin.email, PASSWORD)).rejects.toMatchObject({ code: 'MFA_REQUIRED', translationKey: 'errors.mfaRequired' });
    });

    it('rejects an invalid TOTP code', async () => {
      const prisma = makePrisma();
      prisma.superAdmin.findUnique.mockResolvedValue({ ...baseAdmin, totpEnabledAt: new Date(), totpSecret: `enc(${enrolledSecret})` });
      const svc = new SuperAdminService(prisma, jwt, crypto);
      // A syntactically valid but wrong code (not the current one).
      let wrong = '000000';
      if (wrong === currentTotp(enrolledSecret)) wrong = '000001';
      await expect(svc.login(baseAdmin.email, PASSWORD, wrong)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });

    it('issues a token for a valid TOTP code', async () => {
      const prisma = makePrisma();
      prisma.superAdmin.findUnique.mockResolvedValue({ ...baseAdmin, totpEnabledAt: new Date(), totpSecret: `enc(${enrolledSecret})` });
      const svc = new SuperAdminService(prisma, jwt, crypto);
      const res = await svc.login(baseAdmin.email, PASSWORD, currentTotp(enrolledSecret));
      expect(res).toEqual({ token: 'super.jwt' });
    });

    it('honours a custom token TTL from the environment', async () => {
      process.env.SUPER_ADMIN_TOKEN_TTL = '2h';
      const prisma = makePrisma();
      prisma.superAdmin.findUnique.mockResolvedValue({ ...baseAdmin });
      const svc = new SuperAdminService(prisma, jwt, crypto);
      await svc.login(baseAdmin.email, PASSWORD);
      expect(jwt.sign).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ expiresIn: '2h' }));
      delete process.env.SUPER_ADMIN_TOKEN_TTL;
    });

    it('falls back to the user JWT secret when no super-admin secret is set', async () => {
      const saved = process.env.SUPER_ADMIN_JWT_SECRET;
      delete process.env.SUPER_ADMIN_JWT_SECRET;
      const prisma = makePrisma();
      prisma.superAdmin.findUnique.mockResolvedValue({ ...baseAdmin });
      const svc = new SuperAdminService(prisma, jwt, crypto);
      await svc.login(baseAdmin.email, PASSWORD);
      expect(jwt.sign).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ secret: 'user-secret-for-tests' }));
      process.env.SUPER_ADMIN_JWT_SECRET = saved;
    });
  });

  describe('enrollMfa', () => {
    it('throws NOT_FOUND for a missing admin', async () => {
      const prisma = makePrisma();
      prisma.superAdmin.findUnique.mockResolvedValue(null);
      const svc = new SuperAdminService(prisma, jwt, crypto);
      await expect(svc.enrollMfa('sa1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('rejects when MFA is already enabled', async () => {
      const prisma = makePrisma();
      prisma.superAdmin.findUnique.mockResolvedValue({ ...baseAdmin, totpEnabledAt: new Date() });
      const svc = new SuperAdminService(prisma, jwt, crypto);
      await expect(svc.enrollMfa('sa1')).rejects.toMatchObject({ code: 'VALIDATION', translationKey: 'errors.mfaAlreadyEnabled' });
    });

    it('stores an encrypted pending secret and returns the otpauth URL', async () => {
      const prisma = makePrisma();
      prisma.superAdmin.findUnique.mockResolvedValue({ ...baseAdmin });
      const svc = new SuperAdminService(prisma, jwt, crypto);
      const res = await svc.enrollMfa('sa1');
      expect(res.secret).toMatch(/^[A-Z2-7]+$/);
      expect(res.otpauthUrl).toBe(otpauthUrl(res.secret, baseAdmin.email));
      expect(prisma.superAdmin.update).toHaveBeenCalledWith({ where: { id: 'sa1' }, data: { totpSecret: `enc(${res.secret})` } });
    });
  });

  describe('confirmMfa', () => {
    it('rejects when no secret is enrolled', async () => {
      const prisma = makePrisma();
      prisma.superAdmin.findUnique.mockResolvedValue({ ...baseAdmin, totpSecret: null });
      const svc = new SuperAdminService(prisma, jwt, crypto);
      await expect(svc.confirmMfa('sa1', '123456')).rejects.toMatchObject({ code: 'VALIDATION', translationKey: 'errors.mfaNotEnrolled' });
    });

    it('rejects an invalid confirmation code', async () => {
      const prisma = makePrisma();
      prisma.superAdmin.findUnique.mockResolvedValue({ ...baseAdmin, totpSecret: `enc(${enrolledSecret})` });
      const svc = new SuperAdminService(prisma, jwt, crypto);
      await expect(svc.confirmMfa('sa1', 'abc')).rejects.toMatchObject({ code: 'MFA_INVALID' });
    });

    it('enables MFA on a valid code', async () => {
      const prisma = makePrisma();
      prisma.superAdmin.findUnique.mockResolvedValue({ ...baseAdmin, totpSecret: `enc(${enrolledSecret})` });
      const svc = new SuperAdminService(prisma, jwt, crypto);
      expect(await svc.confirmMfa('sa1', currentTotp(enrolledSecret))).toEqual({ ok: true });
      expect(prisma.superAdmin.update).toHaveBeenCalledWith({ where: { id: 'sa1' }, data: { totpEnabledAt: expect.any(Date) } });
    });
  });

  describe('audit', () => {
    it('writes an audit row with a truncated IP', async () => {
      const prisma = makePrisma();
      const svc = new SuperAdminService(prisma, jwt, crypto);
      const longIp = 'x'.repeat(100);
      await svc.audit('sa1', 'LLM_CONFIG_SET', longIp);
      const arg = prisma.superAdminAuditLog.create.mock.calls[0][0];
      expect(arg.data.superAdminId).toBe('sa1');
      expect(arg.data.action).toBe('LLM_CONFIG_SET');
      expect(arg.data.ip).toHaveLength(64);
    });

    it('tolerates a missing IP', async () => {
      const prisma = makePrisma();
      const svc = new SuperAdminService(prisma, jwt, crypto);
      await svc.audit('sa1', 'ACTION');
      expect(prisma.superAdminAuditLog.create).toHaveBeenCalledWith({ data: { superAdminId: 'sa1', action: 'ACTION', ip: undefined } });
    });

    it('never throws when the audit write fails', async () => {
      const prisma = makePrisma();
      prisma.superAdminAuditLog.create.mockRejectedValue(new Error('db down'));
      const svc = new SuperAdminService(prisma, jwt, crypto);
      await expect(svc.audit('sa1', 'ACTION', '1.2.3.4')).resolves.toBeUndefined();
    });
  });

  describe('totp.util edge cases', () => {
    it('rejects a non 6-digit code format', () => {
      expect(verifyTotp('12', enrolledSecret)).toBe(false);
      expect(verifyTotp('abcdef', enrolledSecret)).toBe(false);
      expect(verifyTotp(undefined as any, enrolledSecret)).toBe(false);
    });
    it('accepts the current code', () => {
      expect(verifyTotp(currentTotp(enrolledSecret), enrolledSecret)).toBe(true);
    });
    it('emits trailing-bit characters for byte lengths not divisible by 5', () => {
      // 1 byte = 8 bits → forces the leftover-bits branch of base32Encode.
      const s = generateBase32Secret(1);
      expect(s).toMatch(/^[A-Z2-7]+$/);
      expect(s.length).toBeGreaterThanOrEqual(2);
    });
    it('skips characters outside the base32 alphabet when decoding', () => {
      // Padding/whitespace are not in the alphabet → exercises the skip branch in base32Decode.
      // '9' is not in the RFC4648 base32 alphabet (2-7) and is not stripped as padding.
      expect(verifyTotp('123456', `9${enrolledSecret}9`)).toBe(false);
    });
  });
});
