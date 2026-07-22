import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SkillReputationListDto } from './dto/skill-reputation.dto';

// Win-rate read model (Phase-6 groundwork). Aggregates the org's Jobs by pipeline
// status — no new tracking needed (status transitions are already captured).
@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  async summary(orgId: string) {
    const jobs = await this.prisma.job.findMany({
      where: { orgId },
      select: { status: true, wonAmountUsd: true, intelligenceJson: true, _count: { select: { documents: true } } },
    });

    const byStatus: Record<string, number> = {};
    for (const j of jobs) byStatus[j.status] = (byStatus[j.status] ?? 0) + 1;

    const n = (s: string) => byStatus[s] ?? 0;
    const won = n('won');
    const lost = n('lost');
    const decided = won + lost;
    const total = jobs.length;
    // "Sent" / applications = anything that reached the client (sent → won/lost).
    const sent = n('sent') + n('viewed') + n('negotiation') + won + lost;
    const assessed = jobs.filter((j) => j.intelligenceJson != null).length;

    // Behavior funnel: assessed → applied (a proposal was generated) → won.
    const applied = jobs.filter((j) => (j._count?.documents ?? 0) > 0).length;
    // "Avoid heeded" = jobs we flagged "avoid" that the user correctly did NOT
    // apply to (no proposal generated). This is the time-saved / don't-waste-the-hour signal.
    const avoidHeeded = jobs.filter((j) => {
      const a = j.intelligenceJson as any;
      return a?.recommendation === 'avoid' && (j._count?.documents ?? 0) === 0;
    }).length;

    // Revenue Won = sum of awarded amounts on won deals (headline KPI).
    const revenueWonUsd = jobs.reduce((s, j) => (j.status === 'won' ? s + (j.wonAmountUsd ?? 0) : s), 0);

    // Revenue Opportunity Lost: opportunities we assessed as worth pursuing
    // (recommendation apply/maybe) but never applied to (still draft) — valued at
    // estimatedBudgetUsd × win-probability. The psychological "you left $X on the table".
    const revenueOpportunityLostUsd = jobs.reduce((s, j) => {
      if (j.status !== 'draft') return s;
      const a = j.intelligenceJson as any;
      if (!a || typeof a !== 'object') return s;
      if (a.recommendation !== 'apply' && a.recommendation !== 'maybe') return s;
      const value = Number(a.estimatedBudgetUsd) || 0;
      const p = Number(a.winProbability?.score) || 0;
      return s + Math.round(value * (p / 100));
    }, 0);

    return {
      total,
      byStatus,
      won,
      lost,
      sent,
      applications: sent,
      assessed,
      applied,
      avoidHeeded,
      // null until at least one deal is decided — never present a fake 0% / 100%.
      winRate: decided > 0 ? Math.round((won / decided) * 100) / 100 : null,
      revenueWonUsd,
      revenuePerProposalUsd: sent > 0 ? Math.round(revenueWonUsd / sent) : null,
      revenueOpportunityLostUsd,
    };
  }

  async bySkill(orgId: string): Promise<SkillReputationListDto> {
    const jobs = await this.prisma.job.findMany({
      where: { orgId },
      select: {
        status: true,
        wonAmountUsd: true,
        intelligenceJson: true,
        createdAt: true,
      },
    });

    // Per-skill accumulators
    const skillMap = new Map<
      string,
      { count: number; decided: number; wins: number; losses: number; wonAmounts: number[] }
    >();

    const decidedStatuses = new Set(['won', 'lost']);

    for (const j of jobs) {
      // Defensive JSON parse: intelligenceJson may be a string, object, null,
      // or other scalar — wrap in try/catch and skip on any error or missing stack.
      let stack: string[] | null = null;
      try {
        const raw = j.intelligenceJson;
        if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
          const candidate = (raw as Record<string, unknown>)['stack'];
          if (Array.isArray(candidate)) {
            stack = candidate.filter((s): s is string => typeof s === 'string');
          }
        }
      } catch {
        // malformed — skip
      }

      if (!stack || stack.length === 0) continue;

      const isDecided = decidedStatuses.has(j.status);
      const isWon = j.status === 'won';
      const isLost = j.status === 'lost';

      const uniqueStack = [...new Set(stack)];
      for (const skill of uniqueStack) {
        if (!skillMap.has(skill)) {
          skillMap.set(skill, { count: 0, decided: 0, wins: 0, losses: 0, wonAmounts: [] });
        }
        const acc = skillMap.get(skill)!;
        acc.count++;
        if (isDecided) acc.decided++;
        if (isWon) {
          acc.wins++;
          if (j.wonAmountUsd != null) acc.wonAmounts.push(j.wonAmountUsd);
        }
        if (isLost) acc.losses++;
      }
    }

    const skills = Array.from(skillMap.entries()).map(([skill, acc]) => ({
      skill,
      count: acc.count,
      decided: acc.decided,
      wins: acc.wins,
      losses: acc.losses,
      winRate: acc.decided > 0 ? Math.round((acc.wins / acc.decided) * 100) / 100 : null,
      avgWonUsd: acc.wonAmounts.length > 0
        ? Math.round(acc.wonAmounts.reduce((s, v) => s + v, 0) / acc.wonAmounts.length)
        : null,
      revenueWonUsd: acc.wonAmounts.reduce((s, v) => s + v, 0),
      // avgCloseDays: null until a decidedAt timestamp exists (see plan deferrals).
      avgCloseDays: null as number | null,
    }));

    // Sort by count desc; tiebreak by winRate desc (null winRate ranks lowest).
    skills.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      const wa = a.winRate ?? -1;
      const wb = b.winRate ?? -1;
      return wb - wa;
    });

    return { skills, minSample: 3 };
  }
}
