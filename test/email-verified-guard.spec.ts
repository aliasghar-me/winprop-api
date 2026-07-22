import { EmailVerifiedGuard } from '../src/auth/guards/email-verified.guard';

// Unit-only: hand-rolled PrismaService + ExecutionContext fakes. Covers the
// verification-not-required passthrough, the verified-user success, and the
// unverified/missing-user rejection. Toggles EMAIL_VERIFICATION_REQUIRED via env
// (EmailVerificationService.required() reads it).

function makeCtx(userId = 'u1') {
  return { switchToHttp: () => ({ getRequest: () => ({ user: { userId } }) }) } as any;
}
const makePrisma = (user: any) => ({ user: { findUnique: jest.fn().mockResolvedValue(user) } } as any);

describe('EmailVerifiedGuard (unit)', () => {
  const ORIGINAL = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL };
    jest.clearAllMocks();
  });

  it('passes through without a DB hit when verification is not required', async () => {
    process.env.EMAIL_VERIFICATION_REQUIRED = 'false';
    process.env.NODE_ENV = 'development';
    const prisma = makePrisma(null);
    const guard = new EmailVerifiedGuard(prisma);
    await expect(guard.canActivate(makeCtx())).resolves.toBe(true);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('allows a user whose email is verified', async () => {
    delete process.env.EMAIL_VERIFICATION_REQUIRED; // required() → true
    const prisma = makePrisma({ id: 'u1', emailVerifiedAt: new Date() });
    const guard = new EmailVerifiedGuard(prisma);
    await expect(guard.canActivate(makeCtx())).resolves.toBe(true);
  });

  it('rejects (403) an unverified user (emailVerifiedAt null)', async () => {
    delete process.env.EMAIL_VERIFICATION_REQUIRED;
    const prisma = makePrisma({ id: 'u1', emailVerifiedAt: null });
    const guard = new EmailVerifiedGuard(prisma);
    await expect(guard.canActivate(makeCtx())).rejects.toMatchObject({
      code: 'EMAIL_NOT_VERIFIED',
      translationKey: 'errors.emailNotVerified',
    });
  });

  it('rejects (403) when the user row is missing entirely (?. optional)', async () => {
    delete process.env.EMAIL_VERIFICATION_REQUIRED;
    const prisma = makePrisma(null);
    const guard = new EmailVerifiedGuard(prisma);
    await expect(guard.canActivate(makeCtx())).rejects.toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
  });
});
