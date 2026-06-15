import { Module } from '@nestjs/common';
import { LlmService, LLM_PROVIDERS } from './llm.service';
import { AnthropicProvider } from './providers/anthropic.provider';
import { OpenAiProvider } from './providers/openai.provider';

@Module({
  providers: [
    AnthropicProvider, OpenAiProvider,
    { provide: LLM_PROVIDERS, useFactory: (a: AnthropicProvider, o: OpenAiProvider) => [a, o], inject: [AnthropicProvider, OpenAiProvider] },
    LlmService,
  ],
  exports: [LlmService],
})
export class LlmModule {}
