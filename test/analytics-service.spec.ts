import { AnalyticsService } from '../src/analytics/analytics.service';

// Unit tests for the Revenue dashboard math. Fake prisma.job.findMany; no DB.
function makeSvc(jobs: any[]) {
  const prisma: any = { job: { findMany: jest.fn().mockResolvedValue(jobs) } };
  return new AnalyticsService(prisma);
}

describe('AnalyticsService.summary — revenue metrics', () => {
  it('computes revenue won, per-proposal, opportunity-lost, win-rate, applications, assessed', async () => {
    const svc = makeSvc([
      { status: 'won', wonAmountUsd: 5000, intelligenceJson: null },
      { status: 'won', wonAmountUsd: 3000, intelligenceJson: null },
      { status: 'lost', wonAmountUsd: null, intelligenceJson: null },
      { status: 'sent', wonAmountUsd: null, intelligenceJson: {} },
      { status: 'draft', wonAmountUsd: null, intelligenceJson: { recommendation: 'apply', estimatedBudgetUsd: 10000, winProbability: { score: 50 } } }, // 5000 expected
      { status: 'draft', wonAmountUsd: null, intelligenceJson: { recommendation: 'avoid', estimatedBudgetUsd: 8000, winProbability: { score: 80 } } }, // excluded (avoid)
      { status: 'draft', wonAmountUsd: null, intelligenceJson: null }, // excluded (not assessed)
    ]);
    const s = await svc.summary('org1');
    expect(s.total).toBe(7);
    expect(s.won).toBe(2);
    expect(s.lost).toBe(1);
    expect(s.sent).toBe(4); // sent(1) + won(2) + lost(1)
    expect(s.applications).toBe(4);
    expect(s.assessed).toBe(3); // three jobs have a non-null intelligenceJson
    expect(s.winRate).toBe(0.67); // 2/3 rounded to 2dp
    expect(s.revenueWonUsd).toBe(8000);
    expect(s.revenuePerProposalUsd).toBe(2000); // 8000 / 4
    expect(s.revenueOpportunityLostUsd).toBe(5000); // only the apply/maybe draft
  });

  it('returns null win-rate and null per-proposal when nothing is decided/applied', async () => {
    const svc = makeSvc([{ status: 'draft', wonAmountUsd: null, intelligenceJson: null }]);
    const s = await svc.summary('org1');
    expect(s.winRate).toBeNull();
    expect(s.revenuePerProposalUsd).toBeNull();
    expect(s.revenueWonUsd).toBe(0);
    expect(s.revenueOpportunityLostUsd).toBe(0);
  });

  it('handles an empty org', async () => {
    const s = await makeSvc([]).summary('org1');
    expect(s).toMatchObject({ total: 0, won: 0, lost: 0, applications: 0, assessed: 0, winRate: null, revenueWonUsd: 0 });
  });
});
