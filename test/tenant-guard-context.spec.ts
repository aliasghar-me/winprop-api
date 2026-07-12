import { TenantGuard } from '../src/common/tenant/tenant.guard';
import {
  getTenantOrgId,
  getTenantStore,
  runUnscoped,
  runWithTenantStore,
  setTenantOrgId,
  tenantEnforceEnabled,
  tenantStorage,
} from '../src/common/tenant/tenant-context';

const ctxFor = (req: any): any => ({
  switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
});

describe('tenant-context helpers', () => {
  const prevMode = process.env.TENANT_EXTENSION_MODE;
  afterEach(() => { process.env.TENANT_EXTENSION_MODE = prevMode; });

  it('returns undefined store/orgId outside any run()', () => {
    expect(getTenantStore()).toBeUndefined();
    expect(getTenantOrgId()).toBeUndefined();
  });

  it('setTenantOrgId is a no-op outside a store (fail-safe)', () => {
    expect(() => setTenantOrgId('o1')).not.toThrow();
    expect(getTenantOrgId()).toBeUndefined();
  });

  it('runWithTenantStore provides a fresh non-bypass store that setTenantOrgId fills', () => {
    runWithTenantStore(() => {
      expect(getTenantStore()).toEqual({ bypass: false });
      setTenantOrgId('o1');
      expect(getTenantOrgId()).toBe('o1');
      expect(getTenantStore()?.bypass).toBe(false);
    });
  });

  it('runUnscoped provides a bypass store', async () => {
    await runUnscoped(async () => {
      expect(getTenantStore()?.bypass).toBe(true);
    });
  });

  it('tenantEnforceEnabled reflects TENANT_EXTENSION_MODE', () => {
    process.env.TENANT_EXTENSION_MODE = 'enforce';
    expect(tenantEnforceEnabled()).toBe(true);
    process.env.TENANT_EXTENSION_MODE = 'audit';
    expect(tenantEnforceEnabled()).toBe(false);
    delete process.env.TENANT_EXTENSION_MODE;
    expect(tenantEnforceEnabled()).toBe(false);
  });
});

describe('TenantGuard (unit)', () => {
  it('sets the org id into an active tenant store and allows the request', () => {
    const guard = new TenantGuard();
    tenantStorage.run({ bypass: false }, () => {
      expect(guard.canActivate(ctxFor({ user: { orgId: 'o1' } }))).toBe(true);
      expect(getTenantOrgId()).toBe('o1');
    });
  });

  it('allows and sets nothing when there is no authenticated user', () => {
    const guard = new TenantGuard();
    tenantStorage.run({ bypass: false }, () => {
      expect(guard.canActivate(ctxFor({}))).toBe(true);
      expect(getTenantOrgId()).toBeUndefined();
    });
  });

  it('allows (fail-open at guard layer) even with no active store — the extension fails closed instead', () => {
    const guard = new TenantGuard();
    // No tenantStorage.run wrapper: setTenantOrgId silently no-ops.
    expect(guard.canActivate(ctxFor({ user: { orgId: 'o1' } }))).toBe(true);
    expect(getTenantOrgId()).toBeUndefined();
  });
});
