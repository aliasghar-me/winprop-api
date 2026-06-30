import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { CryptoService } from '../src/common/crypto/crypto.service';

// Run ONCE after applying the encrypt_user_pii migration (idempotent — safe to re-run):
//   pnpm backfill:pii
// Encrypts any User rows whose email/name are still plaintext and sets emailHash.
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const crypto = new CryptoService(process.env.ENCRYPTION_KEY);

async function main() {
  const rows = await prisma.user.findMany({ where: { emailHash: null } });
  let migrated = 0;
  for (const u of rows) {
    const email = crypto.decryptSafe(u.email); // plaintext if not yet encrypted
    const name = crypto.decryptSafe(u.name);
    await prisma.user.update({
      where: { id: u.id },
      data: { email: crypto.encrypt(email), name: crypto.encrypt(name), emailHash: crypto.hmac(email) },
    });
    migrated++;
  }
  console.log(`PII backfill complete: ${migrated} of ${rows.length} user(s) encrypted`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
