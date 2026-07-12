import { SuperAdminGuard } from '../src/auth/guards/super-admin.guard';
import { AppException } from '../src/common/errors/app-exception';

// Unit-only: drive canActivate() with a fake ExecutionContext + a fake JwtService.
// No Nest DI, no network. Covers the IP allow-list, bearer-token, verify, and
// payload-shape branches.

const ctxFor = (req: any): any => ({
  switchToHttp: () => ({ getRequest: () => req }),
});

const jwtFake = (verify: jest.Mock) => ({ verify } as any);

// Runs canActivate and returns the thrown error (or undefined if it returned).
function catchActivate(guard: SuperAdminGuard, req: any): unknown {
  try {
    guard.canActivate(ctxFor(req));
    return undefined;
  } catch (e) {
    return e;
  }
}

const bearer = (token = 'tok') => ({ authorization: `Bearer ${token}` });

describe('SuperAdminGuard', () => {
  const OLD = { ...process.env };
  afterEach(() => {
    process.env = { ...OLD };
  });
  beforeEach(() => {
    delete process.env.SUPER_ADMIN_IPS;
    delete process.env.SUPER_ADMIN_JWT_SECRET;
    process.env.JWT_SECRET = 'fallback-secret';
  });

  it('accepts a valid super-admin JWT and attaches the admin to the request', () => {
    const verify = jest.fn().mockReturnValue({ scope: 'super-admin', sub: 'sa1', email: 'a@b.co' });
    const guard = new SuperAdminGuard(jwtFake(verify));
    const req: any = { headers: bearer('good'), ip: '1.2.3.4' };
    expect(guard.canActivate(ctxFor(req))).toBe(true);
    expect(req.superAdmin).toEqual({ id: 'sa1', email: 'a@b.co' });
    // uses JWT_SECRET fallback when SUPER_ADMIN_JWT_SECRET is unset
    expect(verify).toHaveBeenCalledWith('good', expect.objectContaining({ secret: 'fallback-secret' }));
  });

  it('prefers SUPER_ADMIN_JWT_SECRET over JWT_SECRET when set', () => {
    process.env.SUPER_ADMIN_JWT_SECRET = 'admin-secret';
    const verify = jest.fn().mockReturnValue({ scope: 'super-admin', sub: 'sa1' });
    const guard = new SuperAdminGuard(jwtFake(verify));
    expect(guard.canActivate(ctxFor({ headers: bearer(), ip: '1.1.1.1' }))).toBe(true);
    expect(verify).toHaveBeenCalledWith('tok', expect.objectContaining({ secret: 'admin-secret' }));
  });

  it('rejects when the authorization header is missing', () => {
    const guard = new SuperAdminGuard(jwtFake(jest.fn()));
    const err = catchActivate(guard, { headers: {} });
    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).code).toBe('FORBIDDEN');
  });

  it('rejects a non-Bearer scheme', () => {
    const guard = new SuperAdminGuard(jwtFake(jest.fn()));
    const err = catchActivate(guard, { headers: { authorization: 'Basic abc' } });
    expect(err).toBeInstanceOf(AppException);
  });

  it('rejects a Bearer header with no token', () => {
    const guard = new SuperAdminGuard(jwtFake(jest.fn()));
    const err = catchActivate(guard, { headers: { authorization: 'Bearer' } });
    expect(err).toBeInstanceOf(AppException);
  });

  it('rejects when jwt.verify throws (invalid/expired token)', () => {
    const verify = jest.fn(() => {
      throw new Error('bad signature');
    });
    const guard = new SuperAdminGuard(jwtFake(verify));
    const err = catchActivate(guard, { headers: bearer('bad'), ip: '1.1.1.1' });
    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).code).toBe('FORBIDDEN');
  });

  it('rejects a token whose scope is not super-admin', () => {
    const verify = jest.fn().mockReturnValue({ scope: 'user', sub: 'u1' });
    const guard = new SuperAdminGuard(jwtFake(verify));
    const err = catchActivate(guard, { headers: bearer(), ip: '1.1.1.1' });
    expect(err).toBeInstanceOf(AppException);
  });

  it('rejects a super-admin token missing sub', () => {
    const verify = jest.fn().mockReturnValue({ scope: 'super-admin' });
    const guard = new SuperAdminGuard(jwtFake(verify));
    const err = catchActivate(guard, { headers: bearer(), ip: '1.1.1.1' });
    expect(err).toBeInstanceOf(AppException);
  });

  describe('SUPER_ADMIN_IPS allow-list', () => {
    it('allows a request whose ip is in the list', () => {
      process.env.SUPER_ADMIN_IPS = '10.0.0.1, 10.0.0.2';
      const verify = jest.fn().mockReturnValue({ scope: 'super-admin', sub: 'sa1' });
      const guard = new SuperAdminGuard(jwtFake(verify));
      expect(guard.canActivate(ctxFor({ headers: bearer(), ip: '10.0.0.2' }))).toBe(true);
    });

    it('denies a request whose ip is not in the list (before any token check)', () => {
      process.env.SUPER_ADMIN_IPS = '10.0.0.1';
      const verify = jest.fn();
      const guard = new SuperAdminGuard(jwtFake(verify));
      const err = catchActivate(guard, { headers: bearer(), ip: '9.9.9.9' });
      expect(err).toBeInstanceOf(AppException);
      expect((err as AppException).code).toBe('FORBIDDEN');
      expect(verify).not.toHaveBeenCalled(); // short-circuits before verifying the token
    });

    it('ignores an allow-list that is empty after trimming', () => {
      process.env.SUPER_ADMIN_IPS = ' , , ';
      const verify = jest.fn().mockReturnValue({ scope: 'super-admin', sub: 'sa1' });
      const guard = new SuperAdminGuard(jwtFake(verify));
      // filter(Boolean) drops the blanks -> allow.length === 0 -> no IP gate
      expect(guard.canActivate(ctxFor({ headers: bearer(), ip: '9.9.9.9' }))).toBe(true);
    });
  });
});
