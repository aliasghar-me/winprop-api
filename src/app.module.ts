import { Module, MiddlewareConsumer, NestModule, ExecutionContext } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { LoggerModule } from 'nestjs-pino';
import { I18nModule, AcceptLanguageResolver, QueryResolver } from 'nestjs-i18n';
import { TenantContextMiddleware } from './common/tenant/tenant-context.middleware.js';
import { IdempotencyInterceptor } from './common/idempotency/idempotency.interceptor.js';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { AppThrottlerGuard } from './common/throttler/app-throttler.guard.js';
import { TRIAL_THROTTLED_KEY } from './common/throttler/trial-throttled.decorator.js';
import { clientIp } from './common/net/client-ip.js';
import { ProfileModule } from './profile/profile.module.js';
import { PublicModule } from './public/public.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { HealthController } from './health/health.controller.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { CryptoModule } from './common/crypto/crypto.module.js';
import { AuthModule } from './auth/auth.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { AdminModule } from './admin/admin.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { BillingModule } from './billing/billing.module.js';
import { UsersModule } from './users/users.module.js';
import { ExportModule } from './export/export.module.js';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { MemoryModule } from './memory/memory.module.js';
import { UserPreferenceResolver } from './i18n/resolvers/user-preference.resolver.js';

@Module({
  imports: [
    // Structured JSON logs with a per-request correlation id; redact secrets.
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        autoLogging: process.env.THROTTLE_DISABLED !== '1', // quiet during e2e
        genReqId: (req, res) => {
          const id = (req.headers['x-request-id'] as string) || randomUUID();
          res.setHeader('x-request-id', id);
          return id;
        },
        redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["idempotency-key"]'],
      },
    }),
    I18nModule.forRoot({
      fallbackLanguage: 'en',
      loaderOptions: {
        path: path.join(process.cwd(), 'src', 'i18n'),
        watch: false,
      },
      resolvers: [
        UserPreferenceResolver,
        AcceptLanguageResolver,
        { use: QueryResolver, options: ['lang'] },
      ],
    }),
    // Global rate limiting (abuse prevention). The `default` throttler keeps the
    // original 100 req/min/IP for the whole app; per-route caps still override it
    // (auth + admin login + the anon preview). The `ipHour`/`ipDay`/`fpMin`
    // throttlers add strict anti-abuse limits for the ANONYMOUS free-trial funnel
    // ONLY — their `skipIf` skips every route that is not @TrialThrottled(), so they
    // never affect authenticated app traffic. Storage is Redis-backed ONLY when
    // REDIS_URL is set (multi-instance); unit/e2e/CI leave it unset → in-memory
    // storage → no external dependency and the coverage gate stays green.
    ThrottlerModule.forRootAsync({
      useFactory: () => {
        const reflector = new Reflector();
        const trialOnly = (ctx: ExecutionContext): boolean =>
          !reflector.getAllAndOverride<boolean>(TRIAL_THROTTLED_KEY, [ctx.getHandler(), ctx.getClass()]);
        const byIp = (req: Record<string, any>) => clientIp(req as any);
        const byFingerprint = (req: Record<string, any>) => req?.body?.fingerprint?.visitorId || clientIp(req as any);
        const throttlers = [
          { name: 'default', ttl: 60_000, limit: 100 },
          { name: 'ipHour', ttl: 3_600_000, limit: 10, skipIf: trialOnly, getTracker: byIp },
          { name: 'ipDay', ttl: 86_400_000, limit: 100, skipIf: trialOnly, getTracker: byIp },
          { name: 'fpMin', ttl: 60_000, limit: 20, skipIf: trialOnly, getTracker: byFingerprint },
        ];
        if (process.env.REDIS_URL) {
          return { throttlers, storage: new ThrottlerStorageRedisService(process.env.REDIS_URL) };
        }
        return { throttlers };
      },
    }),
    PrismaModule,
    CryptoModule,
    AuthModule,
    JobsModule,
    AdminModule,
    DocumentsModule,
    BillingModule,
    UsersModule,
    ProfileModule,
    PublicModule,
    ExportModule,
    AnalyticsModule,
    MemoryModule,
  ],
  controllers: [AppController, HealthController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class AppModule implements NestModule {
  // Establish the tenant store for every request (TenantGuard fills orgId on
  // authenticated, tenant-scoped routes; the Prisma extension reads it).
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}
