import * as bcrypt from 'bcrypt';
import { AuthService } from '../src/auth/auth.service';

// Unit tests only — the service is constructed directly with hand-rolled fakes
// for PrismaService / JwtService / EmailVerificationService / CryptoService.
// bcrypt is imported by the service (not injected) so we use the real library
// with real hashes for the compare() paths.

const PASSWORD = 'correct-password';
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 12);

const crypto: any = {
  hmac: (v: string) => `hmac(${v})`,
  encrypt: (v: string) => `enc(${v})`,
  decrypt: (v: string) => v.replace(/^enc\(|\)$/g, ''),
};

function makeJwt(overrides: Partial<any> = {}) {
  return {
    sign: jest.fn((payload: any) => (payload.typ === 'refresh' ? 'refresh.jwt' : 'access.jwt')),
    verify: jest.fn(),
    decode: jest.fn(() => ({ jti: 'new-jti' })),
    ...overrides,
  } as any;
}

function makeEmailVerification() {
  return { issueForUser: jest.fn().mockResolvedValue(undefined) } as any;
}

describe('AuthService', () => {
  describe('signup', () => {
    const dto: any = {
      email: 'a@b.com',
      password: PASSWORD,
      name: 'Alice',
      agencyName: 'ACME',
      profession: 'developer',
    };

    function makePrisma() {
      const tx = {
        user: { create: jest.fn().mockResolvedValue({ id: 'u1' }) },
        org: { create: jest.fn().mockResolvedValue({ id: 'o1' }) },
        membership: { create: jest.fn().mockResolvedValue({ role: 'owner' }) },
        profile: { create: jest.fn().mockResolvedValue({}) },
      };
      return {
        tx,
        prisma: {
          user: { findUnique: jest.fn().mockResolvedValue(null) },
          refreshToken: { create: jest.fn().mockResolvedValue({}) },
          $transaction: jest.fn(async (cb: any) => cb(tx)),
        } as any,
      };
    }

    it('creates user/org/membership/profile and issues tokens for a new email', async () => {
      const { prisma, tx } = makePrisma();
      const jwt = makeJwt();
      const ev = makeEmailVerification();
      const svc = new AuthService(prisma, jwt, ev, crypto);

      const res = await svc.signup(dto);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { emailHash: 'hmac(a@b.com)' } });
      expect(tx.user.create).toHaveBeenCalled();
      expect(tx.org.create).toHaveBeenCalledWith({ data: { name: 'ACME', profession: 'developer' } });
      expect(tx.profile.create).toHaveBeenCalled();
      expect(ev.issueForUser).toHaveBeenCalledWith('u1', 'a@b.com');
      expect(res).toEqual({ accessToken: 'access.jwt', refreshToken: 'refresh.jwt' });
      expect(prisma.refreshToken.create).toHaveBeenCalled();
    });

    it('throws VALIDATION emailInUse for a duplicate email', async () => {
      const { prisma } = makePrisma();
      prisma.user.findUnique.mockResolvedValue({ id: 'existing' });
      const svc = new AuthService(prisma, makeJwt(), makeEmailVerification(), crypto);

      await expect(svc.signup(dto)).rejects.toMatchObject({ code: 'VALIDATION', translationKey: 'errors.emailInUse' });
    });

    it('swallows a verification-email failure (non-fatal)', async () => {
      const { prisma } = makePrisma();
      const ev = makeEmailVerification();
      ev.issueForUser.mockRejectedValue(new Error('mail down'));
      const svc = new AuthService(prisma, makeJwt(), ev, crypto);

      const res = await svc.signup(dto);
      expect(res).toEqual({ accessToken: 'access.jwt', refreshToken: 'refresh.jwt' });
    });

    it('stamps passwordSetAt when signup provides a real password', async () => {
      const { prisma, tx } = makePrisma();
      const svc = new AuthService(prisma, makeJwt(), makeEmailVerification(), crypto);
      await svc.signup(dto);
      const userData = tx.user.create.mock.calls[0][0].data;
      expect(userData.passwordSetAt).toBeInstanceOf(Date);
    });
  });

  describe('provisionAccount', () => {
    function makePrisma() {
      const tx = {
        user: { create: jest.fn().mockResolvedValue({ id: 'u1' }) },
        org: { create: jest.fn().mockResolvedValue({ id: 'o1' }) },
        membership: { create: jest.fn().mockResolvedValue({ role: 'owner' }) },
        profile: { create: jest.fn().mockResolvedValue({}) },
      };
      return { tx, prisma: { $transaction: jest.fn(async (cb: any) => cb(tx)) } as any };
    }

    it('provisions a trial account (email only): random unusable password, passwordSetAt null, developer defaults', async () => {
      const { prisma, tx } = makePrisma();
      const svc = new AuthService(prisma, makeJwt(), makeEmailVerification(), crypto);
      const out = await svc.provisionAccount({ email: 'trial@x.com' });

      const userData = tx.user.create.mock.calls[0][0].data;
      expect(userData.emailHash).toBe('hmac(trial@x.com)');
      expect(userData.passwordSetAt).toBeNull();
      expect(typeof userData.passwordHash).toBe('string');
      expect(userData.name).toBe('enc()'); // empty name encrypted
      expect(tx.org.create).toHaveBeenCalledWith({ data: { name: '', profession: 'developer' } });
      expect(tx.profile.create).toHaveBeenCalled();
      expect(out).toEqual({ user: { id: 'u1' }, org: { id: 'o1' }, membership: { role: 'owner' } });
    });

    it('uses the provided profession defaults and agencyName', async () => {
      const { prisma, tx } = makePrisma();
      const svc = new AuthService(prisma, makeJwt(), makeEmailVerification(), crypto);
      await svc.provisionAccount({ email: 'e@x.com', name: 'Bob', agencyName: 'Studio', profession: 'designer' as any });
      expect(tx.org.create).toHaveBeenCalledWith({ data: { name: 'Studio', profession: 'designer' } });
      const profileData = tx.profile.create.mock.calls[0][0].data;
      expect(profileData.agencyName).toBe('Studio');
    });
  });

  describe('setPassword', () => {
    it('hashes the new password and stamps passwordSetAt', async () => {
      const prisma: any = { user: { update: jest.fn().mockResolvedValue({}) } };
      const svc = new AuthService(prisma, makeJwt(), makeEmailVerification(), crypto);
      const out = await svc.setPassword('u1', 'a-new-password');
      expect(out).toEqual({ ok: true });
      const arg = prisma.user.update.mock.calls[0][0];
      expect(arg.where).toEqual({ id: 'u1' });
      expect(typeof arg.data.passwordHash).toBe('string');
      expect(arg.data.passwordSetAt).toBeInstanceOf(Date);
    });
  });

  describe('login', () => {
    function makePrisma(user: any) {
      return {
        user: { findUnique: jest.fn().mockResolvedValue(user), update: jest.fn().mockResolvedValue({}) },
        refreshToken: { create: jest.fn().mockResolvedValue({}) },
      } as any;
    }
    const baseUser = {
      id: 'u1',
      passwordHash: PASSWORD_HASH,
      failedLoginCount: 0,
      lockedUntil: null,
      memberships: [{ orgId: 'o1', role: 'owner' }],
    };

    it('succeeds with correct credentials (clean account, no reset)', async () => {
      const prisma = makePrisma({ ...baseUser });
      const svc = new AuthService(prisma, makeJwt(), makeEmailVerification(), crypto);
      const res = await svc.login('a@b.com', PASSWORD);
      expect(res).toEqual({ accessToken: 'access.jwt', refreshToken: 'refresh.jwt' });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('resets failedLoginCount/lockedUntil on a successful login', async () => {
      const prisma = makePrisma({ ...baseUser, failedLoginCount: 3 });
      const svc = new AuthService(prisma, makeJwt(), makeEmailVerification(), crypto);
      await svc.login('a@b.com', PASSWORD);
      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { failedLoginCount: 0, lockedUntil: null } });
    });

    it('allows login when lockedUntil is in the past (also triggers reset)', async () => {
      const prisma = makePrisma({ ...baseUser, lockedUntil: new Date(Date.now() - 1000) });
      const svc = new AuthService(prisma, makeJwt(), makeEmailVerification(), crypto);
      const res = await svc.login('a@b.com', PASSWORD);
      expect(res.accessToken).toBe('access.jwt');
      expect(prisma.user.update).toHaveBeenCalled();
    });

    it('rejects when the account is locked (lockedUntil in the future)', async () => {
      const prisma = makePrisma({ ...baseUser, lockedUntil: new Date(Date.now() + 60_000) });
      const svc = new AuthService(prisma, makeJwt(), makeEmailVerification(), crypto);
      await expect(svc.login('a@b.com', PASSWORD)).rejects.toMatchObject({ code: 'UNAUTHORIZED', translationKey: 'errors.invalidCredentials' });
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('rejects a wrong password and increments the failed count', async () => {
      const prisma = makePrisma({ ...baseUser, failedLoginCount: 2 });
      const svc = new AuthService(prisma, makeJwt(), makeEmailVerification(), crypto);
      await expect(svc.login('a@b.com', 'wrong')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { failedLoginCount: 3 } });
    });

    it('locks the account when the failed count reaches the max', async () => {
      const prisma = makePrisma({ ...baseUser, failedLoginCount: 9 });
      const svc = new AuthService(prisma, makeJwt(), makeEmailVerification(), crypto);
      await expect(svc.login('a@b.com', 'wrong')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      const arg = prisma.user.update.mock.calls[0][0];
      expect(arg.data.failedLoginCount).toBe(0);
      expect(arg.data.lockedUntil).toBeInstanceOf(Date);
    });

    it('swallows a failure while recording a failed login', async () => {
      const prisma = makePrisma({ ...baseUser, failedLoginCount: 1 });
      prisma.user.update.mockRejectedValue(new Error('db down'));
      const svc = new AuthService(prisma, makeJwt(), makeEmailVerification(), crypto);
      await expect(svc.login('a@b.com', 'wrong')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });

    it('rejects (via dummy-hash timing path) when the user does not exist', async () => {
      const prisma = makePrisma(null);
      const svc = new AuthService(prisma, makeJwt(), makeEmailVerification(), crypto);
      await expect(svc.login('nobody@b.com', PASSWORD)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      // No user → no attempt to record a failed login.
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    const validPayload = { sub: 'u1', orgId: 'o1', role: 'owner', typ: 'refresh', jti: 'jti-1' };
    function makePrisma(over: any = {}) {
      return {
        refreshToken: {
          findUnique: jest.fn().mockResolvedValue({ jti: 'jti-1', userId: 'u1', revokedAt: null, expiresAt: new Date(Date.now() + 60_000) }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          update: jest.fn().mockResolvedValue({}),
          create: jest.fn().mockResolvedValue({}),
        },
        membership: { findUnique: jest.fn().mockResolvedValue({ orgId: 'o1', role: 'admin' }) },
        ...over,
      } as any;
    }

    it('rotates the token on a valid refresh (persists replacedById with current role)', async () => {
      const prisma = makePrisma();
      const jwt = makeJwt({ verify: jest.fn(() => ({ ...validPayload })) });
      const svc = new AuthService(prisma, jwt, makeEmailVerification(), crypto);
      const res = await svc.refresh('good.jwt');
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({ where: { jti: 'jti-1', revokedAt: null }, data: { revokedAt: expect.any(Date) } });
      expect(prisma.refreshToken.update).toHaveBeenCalledWith({ where: { jti: 'jti-1' }, data: { replacedById: 'new-jti' } });
      expect(res).toEqual({ accessToken: 'access.jwt', refreshToken: 'refresh.jwt' });
    });

    it('rejects when verification throws', async () => {
      const jwt = makeJwt({ verify: jest.fn(() => { throw new Error('bad'); }) });
      const svc = new AuthService(makePrisma(), jwt, makeEmailVerification(), crypto);
      await expect(svc.refresh('bad.jwt')).rejects.toMatchObject({ translationKey: 'errors.invalidRefreshToken' });
    });

    it('rejects when typ is not refresh', async () => {
      const jwt = makeJwt({ verify: jest.fn(() => ({ ...validPayload, typ: 'access' })) });
      const svc = new AuthService(makePrisma(), jwt, makeEmailVerification(), crypto);
      await expect(svc.refresh('x')).rejects.toMatchObject({ translationKey: 'errors.invalidRefreshToken' });
    });

    it('rejects when jti is missing', async () => {
      const jwt = makeJwt({ verify: jest.fn(() => ({ ...validPayload, jti: undefined })) });
      const svc = new AuthService(makePrisma(), jwt, makeEmailVerification(), crypto);
      await expect(svc.refresh('x')).rejects.toMatchObject({ translationKey: 'errors.invalidRefreshToken' });
    });

    it('rejects when the stored token is missing', async () => {
      const prisma = makePrisma();
      prisma.refreshToken.findUnique.mockResolvedValue(null);
      const jwt = makeJwt({ verify: jest.fn(() => ({ ...validPayload })) });
      const svc = new AuthService(prisma, jwt, makeEmailVerification(), crypto);
      await expect(svc.refresh('x')).rejects.toMatchObject({ translationKey: 'errors.invalidRefreshToken' });
    });

    it('rejects when the stored token belongs to another user', async () => {
      const prisma = makePrisma();
      prisma.refreshToken.findUnique.mockResolvedValue({ jti: 'jti-1', userId: 'someone-else', revokedAt: null, expiresAt: new Date(Date.now() + 60_000) });
      const jwt = makeJwt({ verify: jest.fn(() => ({ ...validPayload })) });
      const svc = new AuthService(prisma, jwt, makeEmailVerification(), crypto);
      await expect(svc.refresh('x')).rejects.toMatchObject({ translationKey: 'errors.invalidRefreshToken' });
    });

    it('detects reuse of a revoked token and revokes the whole chain', async () => {
      const prisma = makePrisma();
      prisma.refreshToken.findUnique.mockResolvedValue({ jti: 'jti-1', userId: 'u1', revokedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) });
      const jwt = makeJwt({ verify: jest.fn(() => ({ ...validPayload })) });
      const svc = new AuthService(prisma, jwt, makeEmailVerification(), crypto);
      await expect(svc.refresh('x')).rejects.toMatchObject({ translationKey: 'errors.invalidRefreshToken' });
      // revokeAllForUser
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({ where: { userId: 'u1', revokedAt: null }, data: { revokedAt: expect.any(Date) } });
    });

    it('rejects an expired stored token', async () => {
      const prisma = makePrisma();
      prisma.refreshToken.findUnique.mockResolvedValue({ jti: 'jti-1', userId: 'u1', revokedAt: null, expiresAt: new Date(Date.now() - 1000) });
      const jwt = makeJwt({ verify: jest.fn(() => ({ ...validPayload })) });
      const svc = new AuthService(prisma, jwt, makeEmailVerification(), crypto);
      await expect(svc.refresh('x')).rejects.toMatchObject({ translationKey: 'errors.invalidRefreshToken' });
    });

    it('rejects with accessRevoked when membership is gone', async () => {
      const prisma = makePrisma();
      prisma.membership.findUnique.mockResolvedValue(null);
      const jwt = makeJwt({ verify: jest.fn(() => ({ ...validPayload })) });
      const svc = new AuthService(prisma, jwt, makeEmailVerification(), crypto);
      await expect(svc.refresh('x')).rejects.toMatchObject({ translationKey: 'errors.accessRevoked' });
    });

    it('treats a lost claim race (count 0) as reuse and revokes the chain', async () => {
      const prisma = makePrisma();
      prisma.refreshToken.updateMany.mockResolvedValueOnce({ count: 0 }); // the claim
      const jwt = makeJwt({ verify: jest.fn(() => ({ ...validPayload })) });
      const svc = new AuthService(prisma, jwt, makeEmailVerification(), crypto);
      await expect(svc.refresh('x')).rejects.toMatchObject({ translationKey: 'errors.invalidRefreshToken' });
    });
  });

  describe('logout / logout-all', () => {
    function makePrisma() {
      return { refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } } as any;
    }

    it('revokeAllForUser revokes every active token', async () => {
      const prisma = makePrisma();
      const svc = new AuthService(prisma, makeJwt(), makeEmailVerification(), crypto);
      const res = await svc.revokeAllForUser('u1');
      expect(res).toEqual({ ok: true });
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({ where: { userId: 'u1', revokedAt: null }, data: { revokedAt: expect.any(Date) } });
    });

    it('logout is a no-op when no token is provided', async () => {
      const prisma = makePrisma();
      const svc = new AuthService(prisma, makeJwt(), makeEmailVerification(), crypto);
      expect(await svc.logout(undefined)).toEqual({ ok: true });
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('logout is a no-op when the token fails to verify', async () => {
      const prisma = makePrisma();
      const jwt = makeJwt({ verify: jest.fn(() => { throw new Error('bad'); }) });
      const svc = new AuthService(prisma, jwt, makeEmailVerification(), crypto);
      expect(await svc.logout('bad.jwt')).toEqual({ ok: true });
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('logout revokes the presented token when it carries a jti', async () => {
      const prisma = makePrisma();
      const jwt = makeJwt({ verify: jest.fn(() => ({ jti: 'jti-1' })) });
      const svc = new AuthService(prisma, jwt, makeEmailVerification(), crypto);
      expect(await svc.logout('good.jwt')).toEqual({ ok: true });
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({ where: { jti: 'jti-1', revokedAt: null }, data: { revokedAt: expect.any(Date) } });
    });

    it('logout tolerates a token without a jti', async () => {
      const prisma = makePrisma();
      const jwt = makeJwt({ verify: jest.fn(() => ({ sub: 'u1' })) });
      const svc = new AuthService(prisma, jwt, makeEmailVerification(), crypto);
      expect(await svc.logout('good.jwt')).toEqual({ ok: true });
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('logout swallows a revoke failure', async () => {
      const prisma = makePrisma();
      prisma.refreshToken.updateMany.mockRejectedValue(new Error('db down'));
      const jwt = makeJwt({ verify: jest.fn(() => ({ jti: 'jti-1' })) });
      const svc = new AuthService(prisma, jwt, makeEmailVerification(), crypto);
      expect(await svc.logout('good.jwt')).toEqual({ ok: true });
    });
  });
});
