import { validateEnv } from './validate-env';

describe('validateEnv (fail-closed secrets)', () => {
  const OK = {
    DATABASE_URL: 'postgresql://x',
    JWT_SECRET: 'x'.repeat(40),
    ENCRYPTION_KEY: 'a'.repeat(64),
    WEB_ORIGIN: 'https://app.winprop.ai',
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_real',
  };
  let saved: NodeJS.ProcessEnv;
  beforeEach(() => { saved = { ...process.env }; for (const k of Object.keys(OK)) delete process.env[k]; });
  afterEach(() => { process.env = saved; });
  const set = (o: Record<string, string>) => Object.assign(process.env, o);

  it('passes when everything valid', () => { set(OK); expect(() => validateEnv()).not.toThrow(); });
  it('throws when JWT_SECRET missing', () => { set({ ...OK, JWT_SECRET: '' }); expect(() => validateEnv()).toThrow(/JWT_SECRET/); });
  it('throws on insecure default JWT_SECRET', () => { set({ ...OK, JWT_SECRET: 'dev-secret' }); expect(() => validateEnv()).toThrow(/insecure default/); });
  it('throws on short JWT_SECRET', () => { set({ ...OK, JWT_SECRET: 'short' }); expect(() => validateEnv()).toThrow(/at least 32/); });
  it('throws on insecure default webhook secret', () => { set({ ...OK, STRIPE_WEBHOOK_SECRET: 'whsec_dummy' }); expect(() => validateEnv()).toThrow(/STRIPE_WEBHOOK_SECRET/); });
  it('throws on bad ENCRYPTION_KEY', () => { set({ ...OK, ENCRYPTION_KEY: 'tooshort' }); expect(() => validateEnv()).toThrow(/ENCRYPTION_KEY/); });
  it('throws when WEB_ORIGIN missing', () => { set({ ...OK, WEB_ORIGIN: '' }); expect(() => validateEnv()).toThrow(/WEB_ORIGIN/); });
  it('never leaks the secret value in the error', () => {
    set({ ...OK, JWT_SECRET: 'dev-secret', STRIPE_SECRET_KEY: '' });
    try { validateEnv(); } catch (e: any) { expect(e.message).not.toContain('x'.repeat(40)); }
  });
});
