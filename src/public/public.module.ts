import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { TrialModule } from '../trial/trial.module';
import { PublicService } from './public.service';
import { PreviewService } from './preview.service';
import { PublicController } from './public.controller';
import { PublicTrialController } from './public-trial.controller';

@Module({
  imports: [LlmModule, TrialModule],
  providers: [PublicService, PreviewService],
  controllers: [PublicController, PublicTrialController],
})
export class PublicModule {}
