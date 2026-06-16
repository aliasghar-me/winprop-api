import { Module } from '@nestjs/common';
import * as path from 'path';
import { I18nModule, AcceptLanguageResolver, QueryResolver } from 'nestjs-i18n';
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
    PrismaModule,
    CryptoModule,
    AuthModule,
    JobsModule,
    AdminModule,
    DocumentsModule,
    BillingModule,
    UsersModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}
