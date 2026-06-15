import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {
  const email = process.env.SUPER_ADMIN_EMAIL || 'root@winprop.ai';
  await prisma.superAdmin.upsert({ where: { email }, update: {}, create: { email } });
  console.log('seeded super-admin', email);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
