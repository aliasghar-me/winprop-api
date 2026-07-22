import { TenantContextMiddleware } from '../src/common/tenant/tenant-context.middleware';
import { getTenantStore } from '../src/common/tenant/tenant-context';

// Unit-only: the middleware just wraps next() in a fresh AsyncLocalStorage tenant
// store. Assert a store exists inside next() and that next() is invoked.
describe('TenantContextMiddleware', () => {
  it('runs next() inside a fresh tenant store (bypass=false) and calls next once', () => {
    const mw = new TenantContextMiddleware();
    let storeInside: any;
    const next = jest.fn(() => {
      storeInside = getTenantStore();
    });
    mw.use({} as any, {} as any, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(storeInside).toEqual({ bypass: false });
    // store is scoped to the request — gone once next() returns
    expect(getTenantStore()).toBeUndefined();
  });
});
