export interface LlmMessages { system: string; user: string; }
export interface LlmResult { text: string; promptTokens: number; completionTokens: number; }
export interface LlmProvider {
  readonly vendor: 'openai' | 'anthropic';
  generate(model: string, apiKey: string, messages: LlmMessages): Promise<LlmResult>;
}
