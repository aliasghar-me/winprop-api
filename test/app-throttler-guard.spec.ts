import { AppThrottlerGuard } from '../src/common/throttler/app-throttler.guard';

// Unit-only: exercise shouldSkip's kill-switch matrix. The guard extends
// ThrottlerGuard but shouldSkip needs no DI, so we call it on a bare instance.
describe('AppThrottlerGuard.shouldSkip', () => {
  const guard = Object.create(AppThrottlerGuard.prototype) as AppThrottlerGuard;
  const shouldSkip = () => (guard as any).shouldSkip();

  const orig = { disabled: process.env.THROTTLE_DISABLED, nodeEnv: process.env.NODE_ENV };
  afterEach(() => {
    process.env.THROTTLE_DISABLED = orig.disabled;
    process.env.NODE_ENV = orig.nodeEnv;
  });

  it('skips when THROTTLE_DISABLED=1 outside production', async () => {
    process.env.THROTTLE_DISABLED = '1';
    process.env.NODE_ENV = 'test';
    await expect(shouldSkip()).resolves.toBe(true);
  });

  it('does NOT skip in production even with THROTTLE_DISABLED=1 (security #10)', async () => {
    process.env.THROTTLE_DISABLED = '1';
    process.env.NODE_ENV = 'production';
    await expect(shouldSkip()).resolves.toBe(false);
  });

  it('does NOT skip when THROTTLE_DISABLED is unset', async () => {
    delete process.env.THROTTLE_DISABLED;
    process.env.NODE_ENV = 'test';
    await expect(shouldSkip()).resolves.toBe(false);
  });
});
