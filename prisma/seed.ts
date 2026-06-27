import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {
  const email = process.env.SUPER_ADMIN_EMAIL || 'root@winprop.ai';
  // Never seed a known default password in production (security audit #3).
  if (process.env.NODE_ENV === 'production' && !process.env.SUPER_ADMIN_PASSWORD) {
    throw new Error('SUPER_ADMIN_PASSWORD is required when seeding in production');
  }
  const password = process.env.SUPER_ADMIN_PASSWORD || 'change-me-in-prod';
  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.superAdmin.upsert({ where: { email }, update: { passwordHash }, create: { email, passwordHash } });
  console.log('seeded super-admin', email);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
