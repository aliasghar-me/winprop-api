import { QuotaGuard } from '../src/documents/quota.guard';

// Unit-only: drive canActivate directly with a fake ExecutionContext + fake Prisma.
// The atomic reserve is a raw SQL statement; we fake $queryRaw to return either a
// row (reserved) or an empty array (exhausted).

const ctxFor = (req: any): any => ({
  switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
});

const makePrisma = () => ({ org: { findUnique: jest.fn() }, $queryRaw: jest.fn() });

describe('QuotaGuard (unit)', () => {
  it('throws NOT_FOUND when the org is missing', async () => {
    const prisma: any = makePrisma();
    prisma.org.findUnique.mockResolvedValue(null);
    const guard = new QuotaGuard(prisma);
    await expect(guard.canActivate(ctxFor({ user: { orgId: 'o1' } }))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('throws SUBSCRIPTION_INACTIVE when a subscription exists but is not active/trialing', async () => {
    const prisma: any = makePrisma();
    prisma.org.findUnique.mockResolvedValue({ id: 'o1', plan: 'starter', createdAt: new Date(), subscription: { status: 'past_due' } });
    const guard = new QuotaGuard(prisma);
    await expect(guard.canActivate(ctxFor({ user: { orgId: 'o1' } }))).rejects.toMatchObject({ code: 'SUBSCRIPTION_INACTIVE' });
  });

  it('throws QUOTA_EXCEEDED when the plan limit is <= 0 (unknown plan)', async () => {
    const prisma: any = makePrisma();
    prisma.org.findUnique.mockResolvedValue({ id: 'o1', plan: 'mystery', createdAt: new Date(), subscription: null });
    const guard = new QuotaGuard(prisma);
    await expect(guard.canActivate(ctxFor({ user: { orgId: 'o1' } }))).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
  });

  it('allows an active subscription and attaches the reservation to the request', async () => {
    const prisma: any = makePrisma();
    const periodEnd = new Date('2025-01-01');
    prisma.org.findUnique.mockResolvedValue({ id: 'o1', plan: 'starter', createdAt: new Date('2024-01-01'), subscription: { status: 'active', currentPeriodEnd: periodEnd } });
    prisma.$queryRaw.mockResolvedValue([{ used: 1 }]);
    const guard = new QuotaGuard(prisma);
    const req: any = { user: { orgId: 'o1' } };
    const ok = await guard.canActivate(ctxFor(req));
    expect(ok).toBe(true);
    expect(req.quotaReservation).toEqual({ orgId: 'o1', periodStart: new Date(periodEnd.getTime() - 30 * 24 * 3600 * 1000) });
  });

  it('allows a trialing subscription', async () => {
    const prisma: any = makePrisma();
    prisma.org.findUnique.mockResolvedValue({ id: 'o1', plan: 'professional', createdAt: new Date('2024-01-01'), subscription: { status: 'trialing' } });
    prisma.$queryRaw.mockResolvedValue([{ used: 5 }]);
    const guard = new QuotaGuard(prisma);
    const req: any = { user: { orgId: 'o1' } };
    expect(await guard.canActivate(ctxFor(req))).toBe(true);
  });

  it('allows when there is no subscription at all (skips the status check)', async () => {
    const prisma: any = makePrisma();
    prisma.org.findUnique.mockResolvedValue({ id: 'o1', plan: 'free', createdAt: new Date('2024-01-01'), subscription: null });
    prisma.$queryRaw.mockResolvedValue([{ used: 1 }]);
    const guard = new QuotaGuard(prisma);
    expect(await guard.canActivate(ctxFor({ user: { orgId: 'o1' } }))).toBe(true);
  });

  it('throws QUOTA_EXCEEDED when the atomic reserve returns no row (period exhausted)', async () => {
    const prisma: any = makePrisma();
    prisma.org.findUnique.mockResolvedValue({ id: 'o1', plan: 'free', createdAt: new Date('2024-01-01'), subscription: null });
    prisma.$queryRaw.mockResolvedValue([]); // UPDATE ... WHERE used < limit matched nothing
    const guard = new QuotaGuard(prisma);
    await expect(guard.canActivate(ctxFor({ user: { orgId: 'o1' } }))).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
  });
});
