import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Win-rate read model (Phase-6 groundwork). Aggregates the org's Jobs by pipeline
// status — no new tracking needed (status transitions are already captured).
@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  async summary(orgId: string) {
    const jobs = await this.prisma.job.findMany({
      where: { orgId },
      select: { status: true, wonAmountUsd: true, intelligenceJson: true },
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
      // null until at least one deal is decided — never present a fake 0% / 100%.
      winRate: decided > 0 ? Math.round((won / decided) * 100) / 100 : null,
      revenueWonUsd,
      revenuePerProposalUsd: sent > 0 ? Math.round(revenueWonUsd / sent) : null,
      revenueOpportunityLostUsd,
    };
  }
}
