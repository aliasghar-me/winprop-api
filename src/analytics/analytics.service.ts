import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Win-rate read model (Phase-6 groundwork). Aggregates the org's Jobs by pipeline
// status — no new tracking needed (status transitions are already captured).
@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  async summary(orgId: string) {
    const grouped = await this.prisma.job.groupBy({ by: ['status'], where: { orgId }, _count: { _all: true } });
    const byStatus: Record<string, number> = {};
    for (const g of grouped) byStatus[g.status] = g._count._all;

    const n = (s: string) => byStatus[s] ?? 0;
    const won = n('won');
    const lost = n('lost');
    const decided = won + lost;
    const total = grouped.reduce((s, g) => s + g._count._all, 0);
    // "Sent" = anything that reached the client (sent → won/lost).
    const sent = n('sent') + n('viewed') + n('negotiation') + won + lost;

    return {
      total,
      byStatus,
      won,
      lost,
      sent,
      // null until at least one deal is decided — never present a fake 0% / 100%.
      winRate: decided > 0 ? Math.round((won / decided) * 100) / 100 : null,
    };
  }
}
