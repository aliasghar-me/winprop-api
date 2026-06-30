import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { QuotaGuard } from './quota.guard';
import { EmailVerifiedGuard } from '../auth/guards/email-verified.guard';
import { LlmModule } from '../llm/llm.module';
import { JobsModule } from '../jobs/jobs.module';

@Module({ imports: [LlmModule, JobsModule], providers: [DocumentsService, QuotaGuard, EmailVerifiedGuard], controllers: [DocumentsController] })
export class DocumentsModule {}
