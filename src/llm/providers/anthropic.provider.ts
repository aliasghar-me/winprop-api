import { Injectable } from '@nestjs/common';
import { LlmProvider, LlmMessages, LlmResult } from '../llm-provider.interface';

@Injectable()
export class AnthropicProvider implements LlmProvider {
  readonly vendor = 'anthropic' as const;
  async generate(model: string, apiKey: string, messages: LlmMessages): Promise<LlmResult> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 2000, system: messages.system, messages: [{ role: 'user', content: messages.user }] }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}`);
    const data: any = await res.json();
    return {
      text: data.content?.[0]?.text ?? '',
      promptTokens: data.usage?.input_tokens ?? 0,
      completionTokens: data.usage?.output_tokens ?? 0,
    };
  }
}
