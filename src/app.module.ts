import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { AuthModule } from './auth/auth.module';
import { JobsModule } from './jobs/jobs.module';
import { AdminModule } from './admin/admin.module';
import { DocumentsModule } from './documents/documents.module';
import { BillingModule } from './billing/billing.module';

@Module({
  imports: [PrismaModule, CryptoModule, AuthModule, JobsModule, AdminModule, DocumentsModule, BillingModule],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}
