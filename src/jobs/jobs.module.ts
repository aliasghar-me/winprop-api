import { Module } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { JobsController } from './jobs.controller';
import { LlmModule } from '../llm/llm.module';
@Module({ imports: [LlmModule], providers: [JobsService], controllers: [JobsController], exports: [JobsService] })
export class JobsModule {}
