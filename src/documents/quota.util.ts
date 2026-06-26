// Shared quota period math (H2). Used by both QuotaGuard (to reserve) and
// DocumentsService (to release on failure) so the (orgId, periodStart) key they
// compute is guaranteed identical.

// Generations per period. free = trial; enterprise = effectively unlimited (custom).
export const PLAN_LIMITS: Record<string, number> = {
  free: 3, starter: 50, professional: 250, agency: 1_000_000, enterprise: 1_000_000,
};

const PERIOD_MS = 30 * 24 * 3600 * 1000;

type PeriodInput = {
  orgCreatedAt: Date;
  subscriptionPeriodEnd?: Date | null;
};

/**
 * The fixed bucket a generation counts against.
 *
 * - With a Stripe subscription: anchor to the billing period (currentPeriodEnd − 30d),
 *   matching the window the webhook keeps fresh.
 * - Otherwise: a deterministic 30-day cycle anchored to the org's signup date.
 *   (The old guard used `Date.now() − 30d`, which is fine for a COUNT lookback but
 *   would defeat a counter — every request would mint a new bucket. Anchoring to
 *   createdAt keeps a stable, rolling 30-day window key.)
 */
export function computePeriodStart(input: PeriodInput, now: Date = new Date()): Date {
  if (input.subscriptionPeriodEnd) {
    return new Date(input.subscriptionPeriodEnd.getTime() - PERIOD_MS);
  }
  const base = input.orgCreatedAt.getTime();
  const cycles = Math.floor((now.getTime() - base) / PERIOD_MS);
  return new Date(base + cycles * PERIOD_MS);
}
