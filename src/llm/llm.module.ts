import { Module } from '@nestjs/common';
import { LlmService, LLM_PROVIDERS } from './llm.service';
import { AnthropicProvider } from './providers/anthropic.provider';
import { OpenAiProvider } from './providers/openai.provider';
import { MockProvider } from './providers/mock.provider';

@Module({
  providers: [
    AnthropicProvider, OpenAiProvider, MockProvider,
    {
      provide: LLM_PROVIDERS,
      // The mock provider is only wired in when LLM_MOCK=true, so a normal
      // production deployment can never accidentally select it.
      useFactory: (a: AnthropicProvider, o: OpenAiProvider, m: MockProvider) =>
        process.env.LLM_MOCK === 'true' ? [a, o, m] : [a, o],
      inject: [AnthropicProvider, OpenAiProvider, MockProvider],
    },
    LlmService,
  ],
  exports: [LlmService],
})
export class LlmModule {}
