import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { backfillQuotaUsage } from '../src/documents/quota.backfill';

// Run ONCE after applying the quota_period migration (and safe to re-run any time):
//   pnpm backfill:quota
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {
  const { orgs, seeded } = await backfillQuotaUsage(prisma);
  console.log(`quota backfill complete: ${seeded} of ${orgs} orgs seeded for their current period`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
