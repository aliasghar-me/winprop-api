import { Prisma } from '@prisma/client';
import { Logger } from '@nestjs/common';
import { getTenantStore, tenantEnforceEnabled } from './tenant-context';

const logger = new Logger('TenantExtension');

// Tenant models → the column that carries the tenant key. `Org` is keyed by `id`;
// the rest by `orgId`. Models NOT listed here are global (User, RefreshToken,
// EmailVerificationToken, LlmConfig — the global config uses orgId:null —,
// SuperAdmin*, ProcessedEvent, WebhookEvent) and pass through untouched.
// Document/DocumentVersion are intentionally NOT here: they have no orgId column
// and are already isolated via their parent Job's ownership check (manual layer).
const TENANT_KEY: Record<string, string> = {
  Org: 'id',
  Membership: 'orgId',
  Profile: 'orgId',
  Job: 'orgId',
  Subscription: 'orgId',
  GenerationLog: 'orgId',
  QuotaPeriod: 'orgId',
};

// Operations whose `where` accepts arbitrary filters → safe to AND-inject the
// tenant key. We deliberately DO NOT touch findUnique / singular update|delete /
// upsert, because Prisma requires a UNIQUE selector there (injecting a non-unique
// field is invalid). Those rely on the manual `where:{orgId}` layer + the fact the
// id was obtained via a scoped read.
const WHERE_OPS = new Set(['findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy', 'updateMany', 'deleteMany']);

/**
 * Defense-in-depth tenant scoping. In 'enforce' mode it injects the tenant key
 * into reads/where and forces it on writes; if a tenant model is queried in an
 * authenticated request with no orgId, it FAILS CLOSED. In 'audit' mode (default)
 * it only logs what it would have changed — zero behavior change.
 */
export const tenantExtension = Prisma.defineExtension((client) =>
  client.$extends({
    name: 'tenant-scoping',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const key = model ? TENANT_KEY[model] : undefined;
          const store = getTenantStore();
          // Not a tenant model, no store (CLI/seed/tests), or explicit bypass → pass through.
          if (!key || !store || store.bypass) return query(args);

          const orgId = store.orgId;
          if (!orgId) {
            if (tenantEnforceEnabled()) {
              throw new Prisma.PrismaClientKnownRequestError(
                `Tenant context missing for ${model}.${operation}`,
                { code: 'P2025', clientVersion: 'tenant-ext' },
              );
            }
            logger.warn(`[audit] missing tenant context for ${model}.${operation}`);
            return query(args);
          }

          if (!tenantEnforceEnabled()) {
            logger.debug(`[audit] would scope ${model}.${operation} by ${key}=${orgId}`);
            return query(args);
          }

          const a = (args ?? {}) as Record<string, any>;
          if (WHERE_OPS.has(operation)) {
            a.where = a.where ? { AND: [a.where, { [key]: orgId }] } : { [key]: orgId };
          } else if (operation === 'create') {
            a.data = { ...(a.data ?? {}), [key]: orgId }; // overwrite any client-supplied tenant key
          } else if (operation === 'createMany') {
            const rows = Array.isArray(a.data) ? a.data : [a.data];
            a.data = rows.map((r: Record<string, unknown>) => ({ ...r, [key]: orgId }));
          } else if (operation === 'upsert') {
            a.create = { ...(a.create ?? {}), [key]: orgId }; // can't touch the unique `where`
          }
          return query(a);
        },
      },
    },
  }),
);
