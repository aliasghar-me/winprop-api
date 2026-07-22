import { UserPreferenceResolver } from '../src/i18n/resolvers/user-preference.resolver';

// Unit-only: fake ExecutionContext. Covers present / absent-user / no-preference.
function makeCtx(req: any) {
  return { switchToHttp: () => ({ getRequest: () => req }) } as any;
}

describe('UserPreferenceResolver.resolve', () => {
  const resolver = new UserPreferenceResolver();

  it('returns the user preferredLanguage when set', () => {
    expect(resolver.resolve(makeCtx({ user: { preferredLanguage: 'fr' } }))).toBe('fr');
  });

  it('returns undefined when the user has no preference', () => {
    expect(resolver.resolve(makeCtx({ user: {} }))).toBeUndefined();
  });

  it('returns undefined when there is no user on the request', () => {
    expect(resolver.resolve(makeCtx({}))).toBeUndefined();
  });

  it('returns undefined when the request is null', () => {
    expect(resolver.resolve(makeCtx(null))).toBeUndefined();
  });
});
