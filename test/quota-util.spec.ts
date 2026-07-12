import { PLAN_LIMITS, computePeriodStart } from '../src/documents/quota.util';

const PERIOD_MS = 30 * 24 * 3600 * 1000;

describe('quota.util', () => {
  describe('PLAN_LIMITS', () => {
    it('exposes the expected per-plan generation caps', () => {
      expect(PLAN_LIMITS.free).toBe(3);
      expect(PLAN_LIMITS.starter).toBe(50);
      expect(PLAN_LIMITS.professional).toBe(250);
      expect(PLAN_LIMITS.agency).toBe(1_000_000);
      expect(PLAN_LIMITS.enterprise).toBe(1_000_000);
    });
  });

  describe('computePeriodStart', () => {
    it('anchors to the billing period (periodEnd - 30d) when a subscription end is present', () => {
      const subscriptionPeriodEnd = new Date('2025-06-30T00:00:00.000Z');
      const start = computePeriodStart({
        orgCreatedAt: new Date('2020-01-01T00:00:00.000Z'), // ignored when subscription present
        subscriptionPeriodEnd,
      });
      expect(start.getTime()).toBe(subscriptionPeriodEnd.getTime() - PERIOD_MS);
    });

    it('ignores a null subscription end and falls back to the createdAt-anchored cycle', () => {
      const orgCreatedAt = new Date('2025-01-01T00:00:00.000Z');
      const now = new Date(orgCreatedAt.getTime() + PERIOD_MS * 2 + 5 * 24 * 3600 * 1000); // 2.x cycles in
      const start = computePeriodStart({ orgCreatedAt, subscriptionPeriodEnd: null }, now);
      // 2 whole cycles elapsed -> bucket anchored at createdAt + 2 * PERIOD_MS
      expect(start.getTime()).toBe(orgCreatedAt.getTime() + 2 * PERIOD_MS);
    });

    it('returns exactly createdAt within the first cycle', () => {
      const orgCreatedAt = new Date('2025-03-10T12:00:00.000Z');
      const now = new Date(orgCreatedAt.getTime() + 3 * 24 * 3600 * 1000); // 3 days later, still cycle 0
      const start = computePeriodStart({ orgCreatedAt }, now);
      expect(start.getTime()).toBe(orgCreatedAt.getTime());
    });

    it('advances to the next bucket exactly on a cycle boundary', () => {
      const orgCreatedAt = new Date('2025-03-10T12:00:00.000Z');
      const now = new Date(orgCreatedAt.getTime() + PERIOD_MS); // exactly one cycle later
      const start = computePeriodStart({ orgCreatedAt }, now);
      expect(start.getTime()).toBe(orgCreatedAt.getTime() + PERIOD_MS);
    });
  });
});
