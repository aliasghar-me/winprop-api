import { AnalyticsService } from '../src/analytics/analytics.service';

// Unit tests for the Revenue dashboard math. Fake prisma.job.findMany; no DB.
function makeSvc(jobs: any[]) {
  const prisma: any = { job: { findMany: jest.fn().mockResolvedValue(jobs) } };
  return new AnalyticsService(prisma);
}

describe('AnalyticsService.summary — revenue metrics', () => {
  it('computes revenue, funnel (assessed → applied → won), and avoid-heeded', async () => {
    const svc = makeSvc([
      { status: 'won', wonAmountUsd: 5000, intelligenceJson: null, _count: { documents: 1 } },
      { status: 'won', wonAmountUsd: 3000, intelligenceJson: null, _count: { documents: 2 } },
      { status: 'lost', wonAmountUsd: null, intelligenceJson: null, _count: { documents: 1 } },
      { status: 'sent', wonAmountUsd: null, intelligenceJson: {}, _count: { documents: 1 } },
      { status: 'draft', wonAmountUsd: null, intelligenceJson: { recommendation: 'apply', estimatedBudgetUsd: 10000, winProbability: { score: 50 } }, _count: { documents: 0 } }, // 5000 expected
      { status: 'draft', wonAmountUsd: null, intelligenceJson: { recommendation: 'avoid', estimatedBudgetUsd: 8000, winProbability: { score: 80 } }, _count: { documents: 0 } }, // avoid heeded
      { status: 'draft', wonAmountUsd: null, intelligenceJson: null, _count: { documents: 0 } }, // not assessed
    ]);
    const s = await svc.summary('org1');
    expect(s.total).toBe(7);
    expect(s.won).toBe(2);
    expect(s.lost).toBe(1);
    expect(s.sent).toBe(4); // sent(1) + won(2) + lost(1)
    expect(s.applications).toBe(4);
    expect(s.assessed).toBe(3); // three jobs have a non-null intelligenceJson
    expect(s.applied).toBe(4); // four jobs have >=1 document
    expect(s.avoidHeeded).toBe(1); // the avoid draft with no proposal
    expect(s.winRate).toBe(0.67); // 2/3 rounded to 2dp
    expect(s.revenueWonUsd).toBe(8000);
    expect(s.revenuePerProposalUsd).toBe(2000); // 8000 / 4
    expect(s.revenueOpportunityLostUsd).toBe(5000); // only the apply/maybe draft
  });

  it('does NOT count an avoid job as heeded if a proposal was generated anyway', async () => {
    const svc = makeSvc([
      { status: 'draft', wonAmountUsd: null, intelligenceJson: { recommendation: 'avoid' }, _count: { documents: 1 } },
    ]);
    const s = await svc.summary('org1');
    expect(s.avoidHeeded).toBe(0);
    expect(s.applied).toBe(1);
  });

  it('returns null win-rate and null per-proposal when nothing is decided/applied', async () => {
    const svc = makeSvc([{ status: 'draft', wonAmountUsd: null, intelligenceJson: null }]);
    const s = await svc.summary('org1');
    expect(s.winRate).toBeNull();
    expect(s.revenuePerProposalUsd).toBeNull();
    expect(s.revenueWonUsd).toBe(0);
    expect(s.revenueOpportunityLostUsd).toBe(0);
  });

  it('handles a won deal with a null wonAmount and an apply-draft with no budget/probability', async () => {
    const svc = makeSvc([
      // won but no awarded amount recorded → revenueWonUsd stays 0 (?? 0 fallback)
      { status: 'won', wonAmountUsd: null, intelligenceJson: null, _count: { documents: 1 } },
      // apply draft but missing estimatedBudgetUsd & winProbability → || 0 fallbacks → adds 0
      { status: 'draft', wonAmountUsd: null, intelligenceJson: { recommendation: 'maybe' }, _count: { documents: 0 } },
      // job without a _count at all → exercises the `_count?.documents ?? 0` optional path
      { status: 'sent', wonAmountUsd: null, intelligenceJson: null },
    ]);
    const s = await svc.summary('org1');
    expect(s.revenueWonUsd).toBe(0);
    expect(s.revenueOpportunityLostUsd).toBe(0);
    expect(s.applied).toBe(1); // only the won job has a document
  });

  it('handles an empty org', async () => {
    const s = await makeSvc([]).summary('org1');
    expect(s).toMatchObject({ total: 0, won: 0, lost: 0, applications: 0, assessed: 0, winRate: null, revenueWonUsd: 0 });
  });
});

describe('AnalyticsService.bySkill — per-skill reputation', () => {
  it('aggregates count/decided/wins/losses/winRate/avgWon per skill from intelligenceJson.stack', async () => {
    const svc = makeSvc([
      { status: 'won', wonAmountUsd: 4000, intelligenceJson: { stack: ['React', 'Node'] }, createdAt: new Date() },
      { status: 'won', wonAmountUsd: 2000, intelligenceJson: { stack: ['React'] }, createdAt: new Date() },
      { status: 'lost', wonAmountUsd: null, intelligenceJson: { stack: ['React'] }, createdAt: new Date() },
      { status: 'draft', wonAmountUsd: null, intelligenceJson: { stack: ['Node'] }, createdAt: new Date() },
    ]);
    const res = await svc.bySkill('org1');
    expect(res.minSample).toBe(3);
    const react = res.skills.find((s) => s.skill === 'React')!;
    expect(react.count).toBe(3); // 2 won + 1 lost all contain React
    expect(react.decided).toBe(3); // 2 won + 1 lost
    expect(react.wins).toBe(2);
    expect(react.losses).toBe(1);
    expect(react.winRate).toBe(0.67); // 2/3 rounded to 2dp
    expect(react.avgWonUsd).toBe(3000); // (4000 + 2000) / 2
    expect(react.revenueWonUsd).toBe(6000);
    expect(react.avgCloseDays).toBeNull();
    // React (count 3) sorts before Node (count 2)
    expect(res.skills[0].skill).toBe('React');
  });

  it('leaves winRate/avgWon null for skills with no decided/won jobs', async () => {
    const svc = makeSvc([
      { status: 'draft', wonAmountUsd: null, intelligenceJson: { stack: ['Rust'] }, createdAt: new Date() },
    ]);
    const res = await svc.bySkill('org1');
    const rust = res.skills.find((s) => s.skill === 'Rust')!;
    expect(rust.winRate).toBeNull();
    expect(rust.avgWonUsd).toBeNull();
    expect(rust.revenueWonUsd).toBe(0);
  });

  it('dedupes a repeated skill within a single job (unique stack)', async () => {
    const svc = makeSvc([
      { status: 'won', wonAmountUsd: 100, intelligenceJson: { stack: ['Go', 'Go', 'Go'] }, createdAt: new Date() },
    ]);
    const res = await svc.bySkill('org1');
    expect(res.skills.find((s) => s.skill === 'Go')!.count).toBe(1);
  });

  it('counts a won job with a null wonAmount without pushing an amount', async () => {
    const svc = makeSvc([
      { status: 'won', wonAmountUsd: null, intelligenceJson: { stack: ['Elixir'] }, createdAt: new Date() },
    ]);
    const res = await svc.bySkill('org1');
    const elixir = res.skills.find((s) => s.skill === 'Elixir')!;
    expect(elixir.wins).toBe(1);
    expect(elixir.avgWonUsd).toBeNull(); // no amount was pushed
    expect(elixir.revenueWonUsd).toBe(0);
  });

  it('tiebreaks two equal-count skills by winRate desc (both non-null)', async () => {
    // Both skills appear in exactly 2 decided jobs; Hi wins both (rate 1), Lo wins one (0.5).
    const svc = makeSvc([
      { status: 'won', wonAmountUsd: 1, intelligenceJson: { stack: ['Hi'] }, createdAt: new Date() },
      { status: 'won', wonAmountUsd: 1, intelligenceJson: { stack: ['Hi'] }, createdAt: new Date() },
      { status: 'won', wonAmountUsd: 1, intelligenceJson: { stack: ['Lo'] }, createdAt: new Date() },
      { status: 'lost', wonAmountUsd: null, intelligenceJson: { stack: ['Lo'] }, createdAt: new Date() },
    ]);
    const res = await svc.bySkill('org1');
    expect(res.skills.map((s) => s.skill)).toEqual(['Hi', 'Lo']);
  });

  it('skips jobs with a missing / non-array / non-object / empty stack', async () => {
    const svc = makeSvc([
      { status: 'won', wonAmountUsd: 1, intelligenceJson: null, createdAt: new Date() }, // null
      { status: 'won', wonAmountUsd: 1, intelligenceJson: 'a string', createdAt: new Date() }, // scalar
      { status: 'won', wonAmountUsd: 1, intelligenceJson: [1, 2], createdAt: new Date() }, // array (not object)
      { status: 'won', wonAmountUsd: 1, intelligenceJson: { stack: 'not-an-array' }, createdAt: new Date() }, // stack not array
      { status: 'won', wonAmountUsd: 1, intelligenceJson: { stack: [] }, createdAt: new Date() }, // empty
      { status: 'won', wonAmountUsd: 1, intelligenceJson: { stack: [42, 'Vue'] }, createdAt: new Date() }, // filters non-strings
    ]);
    const res = await svc.bySkill('org1');
    expect(res.skills).toHaveLength(1);
    expect(res.skills[0].skill).toBe('Vue');
  });

  it('tiebreaks equal counts by winRate desc (null winRate ranks lowest)', async () => {
    const svc = makeSvc([
      // "Alpha": decided with a win → winRate 1
      { status: 'won', wonAmountUsd: 500, intelligenceJson: { stack: ['Alpha'] }, createdAt: new Date() },
      // "Beta": undecided → winRate null, same count (1)
      { status: 'draft', wonAmountUsd: null, intelligenceJson: { stack: ['Beta'] }, createdAt: new Date() },
    ]);
    const res = await svc.bySkill('org1');
    expect(res.skills.map((s) => s.skill)).toEqual(['Alpha', 'Beta']);
  });

  it('handles an empty org', async () => {
    const res = await makeSvc([]).bySkill('org1');
    expect(res.skills).toEqual([]);
  });
});
