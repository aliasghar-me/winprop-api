import { LlmService, LLM_PROVIDERS } from '../src/llm/llm.service';
import { AppException } from '../src/common/errors/app-exception';
import type { LlmProvider, LlmMessages, LlmResult } from '../src/llm/llm-provider.interface';

const okJson = JSON.stringify({
  sections: [{ heading: 'Overview', body: 'A clear overview.' }, { heading: 'Leak', body: 'should be dropped' }],
  lockedTitles: ['Scope', 'Timeline', 'Investment', 'Why us', 'Next steps'],
});

function makeService(provider: LlmProvider, spend = 0, cfg?: { provider: string; model: string }) {
  const prisma: any = {
    llmConfig: {
      findFirst: async () => ({
        orgId: null,
        provider: cfg?.provider ?? 'mock',
        model: cfg?.model ?? 'mock',
        apiKeyEncrypted: 'enc',
      }),
    },
    generationLog: { aggregate: async () => ({ _sum: { costUsd: spend } }) },
  };
  const crypto: any = { decrypt: () => 'key' };
  return new LlmService(prisma, crypto, [provider]);
}

const mockProvider = (text: string): LlmProvider => ({
  vendor: 'mock',
  async generate(_m: string, _k: string, _msg: LlmMessages): Promise<LlmResult> {
    return { text, promptTokens: 100, completionTokens: 50 };
  },
});

describe('LlmService.generatePreview', () => {
  const prevMock = process.env.LLM_MOCK;
  const prevCap = process.env.LLM_ANON_DAILY_USD_CAP;
  beforeAll(() => { process.env.LLM_MOCK = 'true'; });
  afterAll(() => { process.env.LLM_MOCK = prevMock; process.env.LLM_ANON_DAILY_USD_CAP = prevCap; });

  it('returns exactly one visible section + locked titles', async () => {
    const svc = makeService(mockProvider(okJson));
    const out = await svc.generatePreview('A site', 'desc');
    expect(out.sections).toHaveLength(1);
    expect(out.sections[0].heading).toBe('Overview');
    expect(out.lockedTitles).toContain('Scope');
  });

  it('throws llmUnreadable on non-JSON output', async () => {
    const svc = makeService(mockProvider('not json'));
    await expect(svc.generatePreview('A site', 'desc')).rejects.toBeInstanceOf(AppException);
  });

  it('throws when the anonymous daily cap is already reached', async () => {
    process.env.LLM_ANON_DAILY_USD_CAP = '0';
    const svc = makeService(mockProvider(okJson));
    await expect(svc.generatePreview('A site', 'desc')).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
  });

  // Proves real accumulation (not just the degenerate cap=0 case above): 'mock'/'mock'
  // has no pricing entry (always costs $0), so we point the stored config at a PRICED
  // vendor/model (openai:gpt-4o) — resolveProvider() still swaps in the injected mock
  // provider because LLM_MOCK=true, but costUsd() now charges real per-call rates.
  //
  // Note: assertAnonBudget() checks accumulated spend from PRIOR calls only, before the
  // current call runs. So for the 2nd call to be the one that trips, the cap must sit
  // at-or-below one call's cost (not above it) — the 1st call always starts from a spend
  // of 0 and succeeds regardless, then its cost is added to the running total.
  it('accumulates real spend across calls and rejects once the running total hits the cap', async () => {
    const oneCallCostUsd = 100 / 1000 * 0.005 + 50 / 1000 * 0.015; // gpt-4o rate x mock usage (100 in / 50 out) = 0.00125
    process.env.LLM_ANON_DAILY_USD_CAP = String(oneCallCostUsd * 0.8); // > 0, but <= one call's cost
    const svc = makeService(mockProvider(okJson), 0, { provider: 'openai', model: 'gpt-4o' });

    await expect(svc.generatePreview('A site', 'desc')).resolves.toBeDefined(); // 1st call: spend 0 -> under cap, succeeds
    await expect(svc.generatePreview('A site', 'desc')).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' }); // 2nd call: accumulated spend now over cap
  });
});
