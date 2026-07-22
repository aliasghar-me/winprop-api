import { AnalyticsController } from '../src/analytics/analytics.controller';

// Unit-only: drive AnalyticsController with a fake AnalyticsService.

describe('AnalyticsController', () => {
  it('summary delegates to AnalyticsService.summary(orgId)', () => {
    const analytics: any = { summary: jest.fn().mockReturnValue({ revenueWon: 100 }) };
    const ctrl = new AnalyticsController(analytics);
    const out = ctrl.summary({ orgId: 'org1' } as any);
    expect(analytics.summary).toHaveBeenCalledWith('org1');
    expect(out).toEqual({ revenueWon: 100 });
  });

  it('bySkill delegates to AnalyticsService.bySkill(orgId)', () => {
    const analytics: any = { bySkill: jest.fn().mockReturnValue({ skills: [] }) };
    const ctrl = new AnalyticsController(analytics);
    const out = ctrl.bySkill({ orgId: 'org2' } as any);
    expect(analytics.bySkill).toHaveBeenCalledWith('org2');
    expect(out).toEqual({ skills: [] });
  });
});
