import { randomUUID } from 'crypto';
import { computePeriodStart } from './quota.util';

// H2 backfill/reconcile: seed the QuotaPeriod counter from historical GenerationLog
// usage for the CURRENT period of every org. Without this, deploying the atomic
// reserve resets everyone's usage to 0 (no row yet → starts counting from this
// request), letting users exceed their plan in the first period after rollout.
//
// Idempotent and safe to re-run: it only ever RAISES a counter to match history
// (GREATEST), so live in-flight reservations are never clobbered downward.
export async function backfillQuotaUsage(prisma: any): Promise<{ orgs: number; seeded: number }> {
  const orgs = await prisma.org.findMany({ include: { subscription: true } });
  let seeded = 0;
  for (const org of orgs) {
    const periodStart = computePeriodStart({
      orgCreatedAt: org.createdAt,
      subscriptionPeriodEnd: org.subscription?.currentPeriodEnd,
    });
    const used = await prisma.generationLog.count({ where: { orgId: org.id, createdAt: { gte: periodStart } } });
    if (used === 0) continue; // nothing to seed for this org's current period
    await prisma.$executeRaw`
      INSERT INTO "QuotaPeriod" ("id", "orgId", "periodStart", "used")
      VALUES (${randomUUID()}, ${org.id}, ${periodStart}, ${used})
      ON CONFLICT ("orgId", "periodStart")
      DO UPDATE SET "used" = GREATEST("QuotaPeriod"."used", ${used})`;
    seeded++;
  }
  return { orgs: orgs.length, seeded };
}
