import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService } from './analytics.service';
import { PrismaService } from '../prisma/prisma.service';

// Helpers to construct minimal Job-shaped fixtures that match the select fields
// used by the service. All fields not relevant to a test are defaulted to safe values.
function makeJob(overrides: {
  status?: string;
  wonAmountUsd?: number | null;
  intelligenceJson?: unknown;
  createdAt?: Date;
  updatedAt?: Date;
  _count?: { documents: number };
}) {
  return {
    status: overrides.status ?? 'draft',
    wonAmountUsd: overrides.wonAmountUsd ?? null,
    intelligenceJson: overrides.intelligenceJson ?? null,
    createdAt: overrides.createdAt ?? new Date('2024-01-01T00:00:00Z'),
    updatedAt: overrides.updatedAt ?? new Date('2024-01-01T00:00:00Z'),
    _count: overrides._count ?? { documents: 0 },
  };
}

describe('AnalyticsService.bySkill', () => {
  let service: AnalyticsService;
  let prisma: { job: { findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = { job: { findMany: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
  });

  it('aggregates React and Node correctly for a won React+Node job and a lost React-only job', async () => {
    const createdAt = new Date('2024-01-01T00:00:00Z');
    const updatedAt = new Date('2024-01-05T00:00:00Z'); // 4 days later
    prisma.job.findMany.mockResolvedValue([
      makeJob({
        status: 'won',
        wonAmountUsd: 8000,
        intelligenceJson: { stack: ['React', 'Node'] },
        createdAt,
        updatedAt,
      }),
      makeJob({
        status: 'lost',
        wonAmountUsd: null,
        intelligenceJson: { stack: ['React'] },
        createdAt,
        updatedAt,
      }),
    ]);

    const result = await service.bySkill('org-1');
    const react = result.skills.find((s) => s.skill === 'React');
    const node = result.skills.find((s) => s.skill === 'Node');

    expect(react).toBeDefined();
    expect(react!.count).toBe(2);
    expect(react!.decided).toBe(2);
    expect(react!.wins).toBe(1);
    expect(react!.losses).toBe(1);
    expect(react!.winRate).toBe(0.5);
    expect(react!.avgWonUsd).toBe(8000);
    expect(react!.revenueWonUsd).toBe(8000);

    expect(node).toBeDefined();
    expect(node!.count).toBe(1);
    expect(node!.decided).toBe(1);
    expect(node!.wins).toBe(1);
    expect(node!.losses).toBe(0);
    expect(node!.winRate).toBe(1);
    expect(node!.avgWonUsd).toBe(8000);
    expect(node!.revenueWonUsd).toBe(8000);
  });

  it('returns winRate:null and avgWonUsd:null when a skill has only undecided jobs', async () => {
    prisma.job.findMany.mockResolvedValue([
      makeJob({
        status: 'draft',
        wonAmountUsd: null,
        intelligenceJson: { stack: ['Vue'] },
      }),
    ]);

    const result = await service.bySkill('org-1');
    const vue = result.skills.find((s) => s.skill === 'Vue');

    expect(vue).toBeDefined();
    expect(vue!.winRate).toBeNull();
    expect(vue!.avgWonUsd).toBeNull();
    expect(vue!.avgCloseDays).toBeNull();
    expect(vue!.decided).toBe(0);
  });

  it('skips jobs with null intelligenceJson without throwing', async () => {
    prisma.job.findMany.mockResolvedValue([
      makeJob({ status: 'won', wonAmountUsd: 5000, intelligenceJson: null }),
    ]);

    const result = await service.bySkill('org-1');
    expect(result.skills).toHaveLength(0);
  });

  it('skips jobs with malformed intelligenceJson (no stack array) without throwing', async () => {
    prisma.job.findMany.mockResolvedValue([
      makeJob({
        status: 'won',
        wonAmountUsd: 5000,
        intelligenceJson: { recommendation: 'apply' }, // no stack
      }),
      makeJob({
        status: 'won',
        wonAmountUsd: 2000,
        intelligenceJson: 'not-an-object', // raw string
      }),
      makeJob({
        status: 'won',
        wonAmountUsd: 1000,
        intelligenceJson: 42, // unexpected type
      }),
    ]);

    const result = await service.bySkill('org-1');
    expect(result.skills).toHaveLength(0);
  });

  it('returns minSample of 3', async () => {
    prisma.job.findMany.mockResolvedValue([]);
    const result = await service.bySkill('org-1');
    expect(result.minSample).toBe(3);
  });

  it('sorts skills by count descending with winRate as tiebreaker', async () => {
    const createdAt = new Date('2024-01-01T00:00:00Z');
    const updatedAt = new Date('2024-01-03T00:00:00Z');
    prisma.job.findMany.mockResolvedValue([
      // TypeScript: 2 jobs (won + draft) — count 2
      makeJob({ status: 'won', wonAmountUsd: 3000, intelligenceJson: { stack: ['TypeScript'] }, createdAt, updatedAt }),
      makeJob({ status: 'draft', intelligenceJson: { stack: ['TypeScript'] }, createdAt, updatedAt }),
      // Python: 1 won job — count 1
      makeJob({ status: 'won', wonAmountUsd: 6000, intelligenceJson: { stack: ['Python'] }, createdAt, updatedAt }),
    ]);

    const result = await service.bySkill('org-1');
    expect(result.skills[0].skill).toBe('TypeScript'); // count 2 before Python count 1
    expect(result.skills[1].skill).toBe('Python');
  });

  it('computes avgCloseDays as mean of (updatedAt - createdAt) over decided jobs only', async () => {
    const createdAt = new Date('2024-01-01T00:00:00Z');
    // won job: 4 days close time
    const updatedAt1 = new Date('2024-01-05T00:00:00Z');
    // lost job: 2 days close time
    const updatedAt2 = new Date('2024-01-03T00:00:00Z');
    prisma.job.findMany.mockResolvedValue([
      makeJob({
        status: 'won',
        wonAmountUsd: 5000,
        intelligenceJson: { stack: ['Go'] },
        createdAt,
        updatedAt: updatedAt1,
      }),
      makeJob({
        status: 'lost',
        wonAmountUsd: null,
        intelligenceJson: { stack: ['Go'] },
        createdAt,
        updatedAt: updatedAt2,
      }),
    ]);

    const result = await service.bySkill('org-1');
    const go = result.skills.find((s) => s.skill === 'Go');
    // avg of 4 and 2 = 3 days
    expect(go!.avgCloseDays).toBe(3);
  });

  it('deduplicates skills per job — duplicate stack entries are counted once', async () => {
    const createdAt = new Date('2024-01-01T00:00:00Z');
    const updatedAt = new Date('2024-01-05T00:00:00Z');
    prisma.job.findMany.mockResolvedValue([
      makeJob({
        status: 'won',
        wonAmountUsd: 5000,
        intelligenceJson: { stack: ['React', 'React'] },
        createdAt,
        updatedAt,
      }),
    ]);

    const result = await service.bySkill('org-1');
    const react = result.skills.find((s) => s.skill === 'React');

    expect(react).toBeDefined();
    expect(react!.count).toBe(1); // not 2
    expect(react!.wins).toBe(1); // not 2
    expect(react!.decided).toBe(1); // not 2
    expect(react!.revenueWonUsd).toBe(5000);
  });
});
