import { AsyncLocalStorage } from 'async_hooks';

// Request-scoped tenant context (T2.1). A middleware enters an empty store for
// every request; TenantGuard fills `orgId` once the JWT is validated. The Prisma
// tenant extension reads `orgId` at query time to scope tenant models.
export interface TenantStore {
  orgId?: string;
  bypass: boolean; // intentionally context-free work (e.g. background jobs)
}

export const tenantStorage = new AsyncLocalStorage<TenantStore>();

export const getTenantStore = (): TenantStore | undefined => tenantStorage.getStore();
export const getTenantOrgId = (): string | undefined => tenantStorage.getStore()?.orgId;
export const setTenantOrgId = (orgId: string): void => {
  const store = tenantStorage.getStore();
  if (store) store.orgId = orgId;
};

// Run a callback with a fresh tenant store (used by the middleware to wrap a request).
export const runWithTenantStore = <T>(fn: () => T): T => tenantStorage.run({ bypass: false }, fn);

// Explicitly run context-free work (background jobs / cross-tenant admin). The
// extension passes queries through untouched while `bypass` is set.
export const runUnscoped = <T>(fn: () => Promise<T>): Promise<T> =>
  tenantStorage.run({ bypass: true }, fn);

// Extension mode: 'enforce' actually scopes queries; 'audit' (default) only logs
// what it would do — safe to ship live, flip to enforce after observing logs.
export const tenantEnforceEnabled = (): boolean => process.env.TENANT_EXTENSION_MODE === 'enforce';
