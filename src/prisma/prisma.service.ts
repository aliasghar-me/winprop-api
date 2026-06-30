import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { tenantExtension } from '../common/tenant/prisma-tenant.extension';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  // Tenant-scoped client (T2.1). Use `prisma.db.<model>` for tenant-content reads/writes
  // (jobs/documents/profile) so the extension applies; raw queries, $transaction, and
  // global/cross-tenant models stay on `prisma` (the base client). Shares this client's
  // connection, so the $connect/$disconnect below cover both.
  readonly db = this.$extends(tenantExtension);

  constructor() {
    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
    super({ adapter });
  }

  async onModuleInit() { await this.$connect(); }
  async onModuleDestroy() { await this.$disconnect(); }
}
