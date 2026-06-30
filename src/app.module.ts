import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import * as path from 'path';
import { I18nModule, AcceptLanguageResolver, QueryResolver } from 'nestjs-i18n';
import { TenantContextMiddleware } from './common/tenant/tenant-context.middleware.js';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppThrottlerGuard } from './common/throttler/app-throttler.guard.js';
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
import { UserPreferenceResolver } from './i18n/resolvers/user-preference.resolver.js';

@Module({
  imports: [
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
    // Global rate limiting (abuse prevention). Default 100 req/min/IP; tighter
    // per-route caps live on sensitive endpoints (auth + admin login).
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
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
  ],
  controllers: [AppController, HealthController],
  providers: [AppService, { provide: APP_GUARD, useClass: AppThrottlerGuard }],
})
export class AppModule implements NestModule {
  // Establish the tenant store for every request (TenantGuard fills orgId on
  // authenticated, tenant-scoped routes; the Prisma extension reads it).
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}
