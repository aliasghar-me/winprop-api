import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/errors/app-exception';

const PLAN_LIMITS: Record<string, number> = { free: 3, solo: 15, pro: 60, agency: 1_000_000 };

@Injectable()
export class QuotaGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const { user } = ctx.switchToHttp().getRequest();
    const org = await this.prisma.org.findUnique({ where: { id: user.orgId }, include: { subscription: true } });
    if (!org) throw new AppException(404, 'NOT_FOUND', 'Org not found.');
    // Subscription truth: block if a subscription exists but is not active/trialing.
    if (org.subscription && !['active', 'trialing'].includes(org.subscription.status))
      throw new AppException(402, 'SUBSCRIPTION_INACTIVE', 'Your subscription is inactive. Update payment to continue.');
    // --- QUOTA PERIOD SEAM ---
    // When a Stripe subscription exists, anchor the window to its billing period
    // (currentPeriodEnd is written by the Stripe webhook in Task 14). Until then,
    // fall back to a rolling 30-day window. Do NOT hardcode a fixed date here.
    const periodStart = org.subscription?.currentPeriodEnd
      ? new Date(org.subscription.currentPeriodEnd.getTime() - 30 * 24 * 3600 * 1000)
      : new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const used = await this.prisma.generationLog.count({ where: { orgId: org.id, createdAt: { gte: periodStart } } });
    const limit = PLAN_LIMITS[org.plan] ?? 0;
    if (used >= limit) throw new AppException(429, 'QUOTA_EXCEEDED', `You have reached your plan limit of ${limit} generations this period.`);
    return true;
  }
}
