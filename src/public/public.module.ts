import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { PublicService } from './public.service';
import { PreviewService } from './preview.service';
import { PublicController } from './public.controller';

@Module({
  imports: [LlmModule],
  providers: [PublicService, PreviewService],
  controllers: [PublicController],
})
export class PublicModule {}
