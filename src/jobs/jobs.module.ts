import { Module } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { JobsController } from './jobs.controller';
import { LlmModule } from '../llm/llm.module';
import { MemoryModule } from '../memory/memory.module';
import { QuotaGuard } from '../documents/quota.guard';
import { EmailVerifiedGuard } from '../auth/guards/email-verified.guard';
@Module({ imports: [LlmModule, MemoryModule], providers: [JobsService, QuotaGuard, EmailVerifiedGuard], controllers: [JobsController], exports: [JobsService] })
export class JobsModule {}
