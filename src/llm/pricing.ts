// Versioned price map: USD per 1K tokens. Bump PRICE_MAP_VERSION when rates change.
export const PRICE_MAP_VERSION = '2026-06-14';
const RATES: Record<string, { in: number; out: number }> = {
  'anthropic:claude-opus-4-8': { in: 0.015, out: 0.075 },
  'anthropic:claude-sonnet-4-6': { in: 0.003, out: 0.015 },
  'openai:gpt-4o': { in: 0.005, out: 0.015 },
};
export function costUsd(provider: string, model: string, promptTokens: number, completionTokens: number): number {
  const r = RATES[`${provider}:${model}`] ?? { in: 0, out: 0 };
  return +(((promptTokens / 1000) * r.in) + ((completionTokens / 1000) * r.out)).toFixed(6);
}
