import { RolesGuard } from '../src/auth/guards/roles.guard';

// Unit-only: hand-rolled Reflector + ExecutionContext fakes. Covers the
// no-metadata passthrough, the missing/empty required-roles branches, the
// wrong-role rejection, and the allowed-role success.

function makeCtx(user: any) {
  return {
    getHandler: () => 'handler',
    getClass: () => 'class',
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any;
}
const makeReflector = (required: any) => ({ getAllAndOverride: jest.fn().mockReturnValue(required) } as any);

describe('RolesGuard (unit)', () => {
  it('allows when no roles metadata is present (undefined)', () => {
    const guard = new RolesGuard(makeReflector(undefined));
    expect(guard.canActivate(makeCtx({ role: 'member' }))).toBe(true);
  });

  it('allows when the required-roles array is empty', () => {
    const guard = new RolesGuard(makeReflector([]));
    expect(guard.canActivate(makeCtx({ role: 'member' }))).toBe(true);
  });

  it('allows when the user has one of the required roles', () => {
    const guard = new RolesGuard(makeReflector(['owner', 'admin']));
    expect(guard.canActivate(makeCtx({ role: 'admin' }))).toBe(true);
  });

  it('rejects (403) when the user role is not in the required set', () => {
    const guard = new RolesGuard(makeReflector(['owner']));
    expect(() => guard.canActivate(makeCtx({ role: 'member' }))).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN', translationKey: 'errors.roleForbidden' }),
    );
  });

  it('rejects (403) when there is no user on the request', () => {
    const guard = new RolesGuard(makeReflector(['owner']));
    expect(() => guard.canActivate(makeCtx(undefined))).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
  });
});
