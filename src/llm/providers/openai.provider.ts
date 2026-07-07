import { Injectable } from '@nestjs/common';
import { LlmProvider, LlmMessages, LlmResult } from '../llm-provider.interface';

@Injectable()
export class OpenAiProvider implements LlmProvider {
  readonly vendor = 'openai' as const;
  async generate(model: string, apiKey: string, messages: LlmMessages, maxTokens?: number): Promise<LlmResult> {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        // The prompts always ask for a JSON object; force it so JSON.parse never
        // chokes on markdown fences or prose.
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: messages.system }, { role: 'user', content: messages.user }],
        ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
      }),
    });
    if (!res.ok) throw new Error(`openai ${res.status}`);
    const data: any = await res.json();
    return {
      text: data.choices?.[0]?.message?.content ?? '',
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
    };
  }
}
