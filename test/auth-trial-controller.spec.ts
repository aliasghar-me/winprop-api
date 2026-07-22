import { AuthController } from '../src/auth/auth.controller';

// Unit-only: drive the two new AuthController endpoints with fakes. No app/DI.

function makeRes() {
  return {
    cookies: [] as any[],
    cookie(name: string, value: string, opts: any) { this.cookies.push({ name, value, opts }); return this; },
  };
}

describe('AuthController (trial endpoints)', () => {
  describe('claim-trial', () => {
    it('sets the refresh cookie and returns accessToken + needsOnboarding', async () => {
      const trialCheckout: any = {
        claimTrial: jest.fn().mockResolvedValue({
          tokens: { accessToken: 'access.jwt', refreshToken: 'refresh.jwt' },
          needsOnboarding: true,
        }),
      };
      const ctrl = new AuthController({} as any, {} as any, trialCheckout);
      const res = makeRes();
      const out = await ctrl.claimTrial({ sessionId: 'cs_1' } as any, res as any);

      expect(trialCheckout.claimTrial).toHaveBeenCalledWith('cs_1');
      expect(out).toEqual({ accessToken: 'access.jwt', needsOnboarding: true });
      expect(res.cookies[0]).toMatchObject({ name: 'refresh', value: 'refresh.jwt' });
      expect(res.cookies[0].opts).toMatchObject({ httpOnly: true, sameSite: 'none', secure: true });
    });
  });

  describe('set-password', () => {
    it('delegates to AuthService.setPassword for the current user', async () => {
      const auth: any = { setPassword: jest.fn().mockResolvedValue({ ok: true }) };
      const ctrl = new AuthController(auth, {} as any, {} as any);
      const out = await ctrl.setPassword({ userId: 'u1' } as any, { password: 'new-strong-pw' } as any);
      expect(auth.setPassword).toHaveBeenCalledWith('u1', 'new-strong-pw');
      expect(out).toEqual({ ok: true });
    });
  });
});
