// Set the secret BEFORE importing the strategy — its super() reads it at construct time.
process.env.JWT_SECRET = 'test-secret';
import { JwtStrategy } from '../src/auth/jwt.strategy';

// Unit-only: construct directly (passport-jwt Strategy needs a secretOrKey, hence
// the env above) and validate the claim-to-user mapping.
describe('JwtStrategy', () => {
  it('constructs (reads JWT_SECRET from env)', () => {
    expect(new JwtStrategy()).toBeInstanceOf(JwtStrategy);
  });

  it('validate maps JWT claims onto the JwtUser shape', async () => {
    const strat = new JwtStrategy();
    const user = await strat.validate({ sub: 'u1', orgId: 'o1', role: 'owner', preferredLanguage: 'en' });
    expect(user).toEqual({ userId: 'u1', orgId: 'o1', role: 'owner', preferredLanguage: 'en' });
  });

  it('validate leaves preferredLanguage undefined when absent', async () => {
    const strat = new JwtStrategy();
    const user = await strat.validate({ sub: 'u2', orgId: 'o2', role: 'member' });
    expect(user).toEqual({ userId: 'u2', orgId: 'o2', role: 'member', preferredLanguage: undefined });
  });
});
