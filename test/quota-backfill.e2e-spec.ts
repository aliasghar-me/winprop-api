import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { backfillQuotaUsage } from '../src/documents/quota.backfill';

// H2: seeding the new QuotaPeriod counter from historical GenerationLog usage so a
// deploy of the atomic reserve doesn't hand everyone a fresh quota.
describe('Quota backfill', () => {
  let app: INestApplication; let prisma: PrismaService;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init(); prisma = app.get(PrismaService);
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE "QuotaPeriod","GenerationLog","Profile","Membership","Job","Subscription","Org","User" RESTART IDENTITY CASCADE');
  });
  afterAll(async () => { await app.close(); });

  async function seedOrgWithLogs(n: number) {
    const user = await prisma.user.create({ data: { email: `b${n}@x.com`, passwordHash: 'x', name: 'B' } });
    const org = await prisma.org.create({ data: { name: 'O', profession: 'developer', plan: 'free' } });
    await prisma.membership.create({ data: { userId: user.id, orgId: org.id, role: 'owner' } });
    const job = await prisma.job.create({ data: { orgId: org.id, title: 'J' } });
    for (let i = 0; i < n; i++) {
      await prisma.generationLog.create({
        data: { orgId: org.id, jobId: job.id, provider: 'p', model: 'm', promptTokens: 1, completionTokens: 1, costUsd: 0.01, priceMapVersion: 'v' },
      });
    }
    return org.id;
  }

  it('seeds the current-period counter from historical generations', async () => {
    const orgId = await seedOrgWithLogs(2);
    const res = await backfillQuotaUsage(prisma);
    expect(res.seeded).toBe(1);
    const counter = await prisma.quotaPeriod.findFirst({ where: { orgId } });
    expect(counter?.used).toBe(2); // matches the 2 historical logs in this period
  });

  it('is idempotent and never lowers a live counter (re-run = no-op / GREATEST)', async () => {
    const orgId = await seedOrgWithLogs(1);
    await backfillQuotaUsage(prisma);
    // Simulate live reservations having pushed the counter above history.
    await prisma.quotaPeriod.updateMany({ where: { orgId }, data: { used: 3 } });
    await backfillQuotaUsage(prisma); // re-run
    const counter = await prisma.quotaPeriod.findFirst({ where: { orgId } });
    expect(counter?.used).toBe(3); // not clobbered down to the historical 1
  });

  it('skips orgs with no usage', async () => {
    await seedOrgWithLogs(0);
    const res = await backfillQuotaUsage(prisma);
    expect(res.seeded).toBe(0);
    expect(await prisma.quotaPeriod.count()).toBe(0);
  });
});
