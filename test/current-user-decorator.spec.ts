import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { CurrentUser } from '../src/auth/decorators/current-user';

// Unit-only: CurrentUser is a createParamDecorator. Apply it to a throwaway
// method param so Nest records its factory in ROUTE_ARGS_METADATA, extract that
// factory, then invoke it with a fake ExecutionContext to cover both the
// user-present and user-absent branches.
function extractFactory(): (data: unknown, ctx: any) => any {
  class Probe {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-function
    handler(@CurrentUser() _user: unknown) {}
  }
  const meta = Reflect.getMetadata(ROUTE_ARGS_METADATA, Probe, 'handler') as Record<string, { factory: any }>;
  const entry = Object.values(meta)[0];
  return entry.factory;
}

function makeCtx(user: unknown) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any;
}

describe('CurrentUser decorator', () => {
  it('returns request.user when present', () => {
    const factory = extractFactory();
    const user = { userId: 'u1', orgId: 'o1', role: 'owner' };
    expect(factory(undefined, makeCtx(user))).toEqual(user);
  });

  it('returns undefined when request has no user', () => {
    const factory = extractFactory();
    expect(factory(undefined, makeCtx(undefined))).toBeUndefined();
  });
});
