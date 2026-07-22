import { AuthController } from '../src/auth/auth.controller';
import { AppException } from '../src/common/errors/app-exception';

// Unit-only: drive AuthController with hand-rolled fakes. No app/DI.
// Covers signup/login/refresh/logout/logout-all/verify-email/resend-verification,
// plus the private cookie-option branches (sameSite/secure) and assertOrigin.

function makeRes() {
  return {
    cookies: [] as any[],
    cleared: [] as any[],
    cookie(name: string, value: string, opts: any) { this.cookies.push({ name, value, opts }); return this; },
    clearCookie(name: string, opts: any) { this.cleared.push({ name, opts }); return this; },
  };
}

const tokens = { accessToken: 'access.jwt', refreshToken: 'refresh.jwt' };

describe('AuthController', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV };
    delete process.env.AUTH_COOKIE_SAMESITE;
    delete process.env.NODE_ENV;
    delete process.env.WEB_ORIGIN;
  });
  afterAll(() => { process.env = OLD_ENV; });

  describe('signup', () => {
    it('signs up, sets the refresh cookie, returns accessToken', async () => {
      const auth: any = { signup: jest.fn().mockResolvedValue(tokens) };
      const ctrl = new AuthController(auth, {} as any, {} as any);
      const res = makeRes();
      const out = await ctrl.signup({ email: 'a@b.co', password: 'pw' } as any, res as any);
      expect(auth.signup).toHaveBeenCalledWith({ email: 'a@b.co', password: 'pw' });
      expect(out).toEqual({ accessToken: 'access.jwt' });
      // default sameSite 'none' → secure true
      expect(res.cookies[0]).toMatchObject({ name: 'refresh', value: 'refresh.jwt' });
      expect(res.cookies[0].opts).toMatchObject({ httpOnly: true, sameSite: 'none', secure: true, maxAge: 7 * 24 * 3600 * 1000 });
    });
  });

  describe('login', () => {
    it('logs in with email + password, sets cookie, returns accessToken', async () => {
      const auth: any = { login: jest.fn().mockResolvedValue(tokens) };
      const ctrl = new AuthController(auth, {} as any, {} as any);
      const res = makeRes();
      const out = await ctrl.login({ email: 'a@b.co', password: 'pw' } as any, res as any);
      expect(auth.login).toHaveBeenCalledWith('a@b.co', 'pw');
      expect(out).toEqual({ accessToken: 'access.jwt' });
      expect(res.cookies[0]).toMatchObject({ name: 'refresh', value: 'refresh.jwt' });
    });
  });

  describe('refresh', () => {
    it('reads the refresh cookie, rotates, sets a new cookie', async () => {
      const auth: any = { refresh: jest.fn().mockResolvedValue(tokens) };
      const ctrl = new AuthController(auth, {} as any, {} as any);
      const res = makeRes();
      const req: any = { headers: {}, cookies: { refresh: 'old.refresh' } };
      const out = await ctrl.refresh(req, res as any);
      expect(auth.refresh).toHaveBeenCalledWith('old.refresh');
      expect(out).toEqual({ accessToken: 'access.jwt' });
      expect(res.cookies[0]).toMatchObject({ name: 'refresh', value: 'refresh.jwt' });
    });

    it('passes undefined when cookies are absent (optional-chaining branch)', async () => {
      const auth: any = { refresh: jest.fn().mockResolvedValue(tokens) };
      const ctrl = new AuthController(auth, {} as any, {} as any);
      const req: any = { headers: {} }; // no cookies
      await ctrl.refresh(req, makeRes() as any);
      expect(auth.refresh).toHaveBeenCalledWith(undefined);
    });

    it('allows a request with an allow-listed Origin', async () => {
      process.env.WEB_ORIGIN = 'https://app.winprop.io,https://ext.winprop.io';
      const auth: any = { refresh: jest.fn().mockResolvedValue(tokens) };
      const ctrl = new AuthController(auth, {} as any, {} as any);
      const req: any = { headers: { origin: 'https://ext.winprop.io' }, cookies: { refresh: 'r' } };
      await expect(ctrl.refresh(req, makeRes() as any)).resolves.toEqual({ accessToken: 'access.jwt' });
    });

    it('rejects a disallowed Origin with a 403 AppException', async () => {
      process.env.WEB_ORIGIN = 'https://app.winprop.io';
      const auth: any = { refresh: jest.fn() };
      const ctrl = new AuthController(auth, {} as any, {} as any);
      const req: any = { headers: { origin: 'https://evil.example' }, cookies: { refresh: 'r' } };
      await expect(ctrl.refresh(req, makeRes() as any)).rejects.toBeInstanceOf(AppException);
      expect(auth.refresh).not.toHaveBeenCalled();
    });

    it('rejects a disallowed Origin even when WEB_ORIGIN is unset (empty allow-list)', async () => {
      const auth: any = { refresh: jest.fn() };
      const ctrl = new AuthController(auth, {} as any, {} as any);
      const req: any = { headers: { origin: 'https://evil.example' }, cookies: { refresh: 'r' } };
      await expect(ctrl.refresh(req, makeRes() as any)).rejects.toBeInstanceOf(AppException);
      expect(auth.refresh).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('revokes the refresh token and clears the cookie', async () => {
      const auth: any = { logout: jest.fn().mockResolvedValue(undefined) };
      const ctrl = new AuthController(auth, {} as any, {} as any);
      const res = makeRes();
      const req: any = { headers: {}, cookies: { refresh: 'r' } };
      const out = await ctrl.logout(req, res as any);
      expect(auth.logout).toHaveBeenCalledWith('r');
      expect(res.cleared[0]).toMatchObject({ name: 'refresh' });
      expect(res.cleared[0].opts).toMatchObject({ httpOnly: true, sameSite: 'none', secure: true });
      expect(out).toEqual({ ok: true });
    });

    it('handles a missing refresh cookie (optional-chaining branch)', async () => {
      const auth: any = { logout: jest.fn().mockResolvedValue(undefined) };
      const ctrl = new AuthController(auth, {} as any, {} as any);
      const req: any = { headers: {} };
      await ctrl.logout(req, makeRes() as any);
      expect(auth.logout).toHaveBeenCalledWith(undefined);
    });
  });

  describe('logout-all', () => {
    it('revokes all tokens for the current user and clears the cookie', async () => {
      const auth: any = { revokeAllForUser: jest.fn().mockResolvedValue(undefined) };
      const ctrl = new AuthController(auth, {} as any, {} as any);
      const res = makeRes();
      const out = await ctrl.logoutAll({ userId: 'u1' } as any, res as any);
      expect(auth.revokeAllForUser).toHaveBeenCalledWith('u1');
      expect(res.cleared[0]).toMatchObject({ name: 'refresh' });
      expect(out).toEqual({ ok: true });
    });
  });

  describe('verify-email / resend-verification', () => {
    it('verifyEmail delegates to EmailVerificationService.verify(token)', () => {
      const ev: any = { verify: jest.fn().mockReturnValue({ ok: true }) };
      const ctrl = new AuthController({} as any, ev, {} as any);
      const out = ctrl.verifyEmail({ token: 'tok' } as any);
      expect(ev.verify).toHaveBeenCalledWith('tok');
      expect(out).toEqual({ ok: true });
    });

    it('resendVerification delegates to EmailVerificationService.resend(userId)', () => {
      const ev: any = { resend: jest.fn().mockReturnValue({ ok: true }) };
      const ctrl = new AuthController({} as any, ev, {} as any);
      const out = ctrl.resendVerification({ userId: 'u9' } as any);
      expect(ev.resend).toHaveBeenCalledWith('u9');
      expect(out).toEqual({ ok: true });
    });
  });

  describe('refreshCookieOptions branches (via setRefresh)', () => {
    it("sameSite 'lax' + non-production → secure false", async () => {
      process.env.AUTH_COOKIE_SAMESITE = 'lax';
      process.env.NODE_ENV = 'development';
      const auth: any = { signup: jest.fn().mockResolvedValue(tokens) };
      const ctrl = new AuthController(auth, {} as any, {} as any);
      const res = makeRes();
      await ctrl.signup({} as any, res as any);
      expect(res.cookies[0].opts).toMatchObject({ sameSite: 'lax', secure: false });
    });

    it("sameSite 'lax' + production → secure true", async () => {
      process.env.AUTH_COOKIE_SAMESITE = 'lax';
      process.env.NODE_ENV = 'production';
      const auth: any = { signup: jest.fn().mockResolvedValue(tokens) };
      const ctrl = new AuthController(auth, {} as any, {} as any);
      const res = makeRes();
      await ctrl.signup({} as any, res as any);
      expect(res.cookies[0].opts).toMatchObject({ sameSite: 'lax', secure: true });
    });

    it("sameSite 'strict' + non-production → secure false", async () => {
      process.env.AUTH_COOKIE_SAMESITE = 'strict';
      const auth: any = { signup: jest.fn().mockResolvedValue(tokens) };
      const ctrl = new AuthController(auth, {} as any, {} as any);
      const res = makeRes();
      await ctrl.signup({} as any, res as any);
      expect(res.cookies[0].opts).toMatchObject({ sameSite: 'strict', secure: false });
    });
  });

  describe('claim-trial / set-password (also on this controller)', () => {
    it('claimTrial sets the refresh cookie and returns accessToken + needsOnboarding', async () => {
      const trialCheckout: any = {
        claimTrial: jest.fn().mockResolvedValue({ tokens, needsOnboarding: false }),
      };
      const ctrl = new AuthController({} as any, {} as any, trialCheckout);
      const res = makeRes();
      const out = await ctrl.claimTrial({ sessionId: 'cs_1' } as any, res as any);
      expect(trialCheckout.claimTrial).toHaveBeenCalledWith('cs_1');
      expect(out).toEqual({ accessToken: 'access.jwt', needsOnboarding: false });
      expect(res.cookies[0]).toMatchObject({ name: 'refresh', value: 'refresh.jwt' });
    });

    it('setPassword delegates to AuthService.setPassword', () => {
      const auth: any = { setPassword: jest.fn().mockReturnValue({ ok: true }) };
      const ctrl = new AuthController(auth, {} as any, {} as any);
      const out = ctrl.setPassword({ userId: 'u1' } as any, { password: 'pw' } as any);
      expect(auth.setPassword).toHaveBeenCalledWith('u1', 'pw');
      expect(out).toEqual({ ok: true });
    });
  });
});
