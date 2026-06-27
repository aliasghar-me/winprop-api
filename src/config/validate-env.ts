// Fail-closed environment validation (security audit #1–#4). Called at the very
// top of bootstrap() BEFORE the Nest app is created, so the process refuses to
// start with missing/weak/default secrets instead of silently using fallbacks.
// NOTE: this runs only at real boot (`node dist/src/main.js`) — not in unit/e2e
// tests, which construct the app via Test.createTestingModule.

const BANNED_DEFAULTS: Record<string, string> = {
  JWT_SECRET: 'dev-secret',
  STRIPE_WEBHOOK_SECRET: 'whsec_dummy',
};

export function validateEnv(): void {
  const errors: string[] = [];
  const req = (name: string) => {
    const v = process.env[name];
    if (!v || v.trim() === '') errors.push(`${name} is required`);
    else if (BANNED_DEFAULTS[name] && v === BANNED_DEFAULTS[name]) errors.push(`${name} must not be the insecure default "${v}"`);
    return v;
  };

  req('DATABASE_URL');
  const jwt = req('JWT_SECRET');
  if (jwt && jwt.length < 32) errors.push('JWT_SECRET must be at least 32 chars');
  const enc = process.env.ENCRYPTION_KEY;
  if (!enc || !/^[0-9a-fA-F]{64}$/.test(enc)) errors.push('ENCRYPTION_KEY must be 64 hex chars (32 bytes)');
  req('WEB_ORIGIN');
  req('STRIPE_SECRET_KEY');
  req('STRIPE_WEBHOOK_SECRET');

  if (errors.length) {
    // Do not leak values — names only.
    throw new Error(`Refusing to start — invalid environment:\n  - ${errors.join('\n  - ')}`);
  }
}
