import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/errors/app-exception';
import { PLAN_LIMITS, computePeriodStart } from './quota.util';

@Injectable()
export class QuotaGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const { user } = req;
    const org = await this.prisma.org.findUnique({ where: { id: user.orgId }, include: { subscription: true } });
    if (!org) throw new AppException(404, 'NOT_FOUND', 'errors.orgNotFound');
    // Subscription truth: block if a subscription exists but is not active/trialing.
    if (org.subscription && !['active', 'trialing'].includes(org.subscription.status))
      throw new AppException(402, 'SUBSCRIPTION_INACTIVE', 'errors.subscriptionInactive');

    const limit = PLAN_LIMITS[org.plan] ?? 0;
    if (limit <= 0) throw new AppException(429, 'QUOTA_EXCEEDED', 'errors.quotaExceeded', { limit });

    const periodStart = computePeriodStart({
      orgCreatedAt: org.createdAt,
      subscriptionPeriodEnd: org.subscription?.currentPeriodEnd,
    });

    // --- ATOMIC RESERVE (H2) ---
    // One statement does the check AND the increment. On a fresh period the row is
    // inserted with used=1. On an existing row it increments only WHILE used < limit;
    // at the boundary the UPDATE's WHERE fails, no row is returned, and we reject.
    // Two concurrent requests therefore can't both pass — Postgres serialises the
    // conflicting upserts on the unique (orgId, periodStart) key.
    const rows = await this.prisma.$queryRaw<Array<{ used: number }>>`
      INSERT INTO "QuotaPeriod" ("id", "orgId", "periodStart", "used")
      VALUES (${randomUUID()}, ${org.id}, ${periodStart}, 1)
      ON CONFLICT ("orgId", "periodStart")
      DO UPDATE SET "used" = "QuotaPeriod"."used" + 1
      WHERE "QuotaPeriod"."used" < ${limit}
      RETURNING "used"`;

    if (rows.length === 0) throw new AppException(429, 'QUOTA_EXCEEDED', 'errors.quotaExceeded', { limit });

    // Hand the reservation to the service so it can release on a failed generation.
    req.quotaReservation = { orgId: org.id, periodStart };
    return true;
  }
}
