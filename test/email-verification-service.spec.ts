import { createHash } from 'crypto';
import { EmailVerificationService } from '../src/auth/email-verification.service';

// Unit tests only — hand-rolled fakes for PrismaService / MailService / CryptoService.

const sha256 = (raw: string) => createHash('sha256').update(raw).digest('hex');

function makeMail() {
  return { sendVerificationEmail: jest.fn().mockResolvedValue(undefined) } as any;
}
const crypto: any = { decryptSafe: jest.fn((v: string) => (v ? `plain(${v})` : '')) };

function makePrisma(over: any = {}) {
  return {
    emailVerificationToken: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    user: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    // array form: prisma.$transaction([...])
    $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
    ...over,
  } as any;
}

describe('EmailVerificationService', () => {
  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.clearAllMocks();
  });

  describe('required()', () => {
    it('defaults to true when nothing is set', () => {
      delete process.env.EMAIL_VERIFICATION_REQUIRED;
      delete process.env.NODE_ENV;
      expect(EmailVerificationService.required()).toBe(true);
    });

    it('is disable-able outside production', () => {
      process.env.EMAIL_VERIFICATION_REQUIRED = 'false';
      process.env.NODE_ENV = 'development';
      expect(EmailVerificationService.required()).toBe(false);
    });

    it('cannot be disabled in production', () => {
      process.env.EMAIL_VERIFICATION_REQUIRED = 'false';
      process.env.NODE_ENV = 'production';
      expect(EmailVerificationService.required()).toBe(true);
    });
  });

  describe('issueForUser', () => {
    it('invalidates prior tokens, creates a hashed token, and emails the link', async () => {
      process.env.WEB_ORIGIN = 'https://app.example.com,https://second.example.com';
      const prisma = makePrisma();
      const mail = makeMail();
      const svc = new EmailVerificationService(prisma, mail, crypto);

      await svc.issueForUser('u1', 'a@b.com');

      expect(prisma.emailVerificationToken.updateMany).toHaveBeenCalledWith({ where: { userId: 'u1', consumedAt: null }, data: { consumedAt: expect.any(Date) } });
      const createArg = prisma.emailVerificationToken.create.mock.calls[0][0];
      expect(createArg.data.userId).toBe('u1');
      expect(createArg.data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(prisma.$transaction).toHaveBeenCalled();

      expect(mail.sendVerificationEmail).toHaveBeenCalledTimes(1);
      const [to, url] = mail.sendVerificationEmail.mock.calls[0];
      expect(to).toBe('a@b.com');
      // Uses the FIRST WEB_ORIGIN entry and carries the raw token.
      expect(url).toMatch(/^https:\/\/app\.example\.com\/verify-email\?token=/);
      // The emailed raw token hashes to the stored tokenHash.
      const raw = url.split('token=')[1];
      expect(sha256(raw)).toBe(createArg.data.tokenHash);
    });

    it('falls back to the default web origin when WEB_ORIGIN is unset', async () => {
      delete process.env.WEB_ORIGIN;
      const mail = makeMail();
      const svc = new EmailVerificationService(makePrisma(), mail, crypto);
      await svc.issueForUser('u1', 'a@b.com');
      const url = mail.sendVerificationEmail.mock.calls[0][1];
      expect(url).toMatch(/^https:\/\/app\.winprop\.ai\/verify-email\?token=/);
    });
  });

  describe('verify', () => {
    it('rejects an empty token', async () => {
      const svc = new EmailVerificationService(makePrisma(), makeMail(), crypto);
      await expect(svc.verify('')).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    });

    it('rejects an unknown token', async () => {
      const prisma = makePrisma();
      prisma.emailVerificationToken.findUnique.mockResolvedValue(null);
      const svc = new EmailVerificationService(prisma, makeMail(), crypto);
      await expect(svc.verify('nope')).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    });

    it('rejects an already-consumed token', async () => {
      const prisma = makePrisma();
      prisma.emailVerificationToken.findUnique.mockResolvedValue({ id: 't1', userId: 'u1', consumedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) });
      const svc = new EmailVerificationService(prisma, makeMail(), crypto);
      await expect(svc.verify('used')).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    });

    it('rejects an expired token', async () => {
      const prisma = makePrisma();
      prisma.emailVerificationToken.findUnique.mockResolvedValue({ id: 't1', userId: 'u1', consumedAt: null, expiresAt: new Date(Date.now() - 1000) });
      const svc = new EmailVerificationService(prisma, makeMail(), crypto);
      await expect(svc.verify('old')).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    });

    it('consumes a valid token and marks the user verified', async () => {
      const prisma = makePrisma();
      prisma.emailVerificationToken.findUnique.mockResolvedValue({ id: 't1', userId: 'u1', consumedAt: null, expiresAt: new Date(Date.now() + 60_000) });
      const svc = new EmailVerificationService(prisma, makeMail(), crypto);

      const res = await svc.verify('good');
      expect(res).toEqual({ ok: true });
      expect(prisma.emailVerificationToken.findUnique).toHaveBeenCalledWith({ where: { tokenHash: sha256('good') } });
      expect(prisma.emailVerificationToken.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { consumedAt: expect.any(Date) } });
      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { emailVerifiedAt: expect.any(Date) } });
    });
  });

  describe('resend', () => {
    it('re-issues for an unverified user (decrypting the stored email)', async () => {
      const prisma = makePrisma();
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'enc-email', emailVerifiedAt: null });
      const mail = makeMail();
      const svc = new EmailVerificationService(prisma, mail, crypto);

      const res = await svc.resend('u1');
      expect(res).toEqual({ ok: true });
      expect(crypto.decryptSafe).toHaveBeenCalledWith('enc-email');
      expect(mail.sendVerificationEmail).toHaveBeenCalledWith('plain(enc-email)', expect.any(String));
    });

    it('is a no-op for an already-verified user', async () => {
      const prisma = makePrisma();
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'enc-email', emailVerifiedAt: new Date() });
      const mail = makeMail();
      const svc = new EmailVerificationService(prisma, mail, crypto);

      expect(await svc.resend('u1')).toEqual({ ok: true });
      expect(mail.sendVerificationEmail).not.toHaveBeenCalled();
    });

    it('is a no-op when the user does not exist', async () => {
      const prisma = makePrisma();
      prisma.user.findUnique.mockResolvedValue(null);
      const mail = makeMail();
      const svc = new EmailVerificationService(prisma, mail, crypto);

      expect(await svc.resend('missing')).toEqual({ ok: true });
      expect(mail.sendVerificationEmail).not.toHaveBeenCalled();
    });
  });
});
