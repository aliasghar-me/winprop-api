import { LlmService, LLM_PROVIDERS } from '../src/llm/llm.service';
import { AppException } from '../src/common/errors/app-exception';
import type { LlmProvider, LlmMessages, LlmResult } from '../src/llm/llm-provider.interface';

const okJson = JSON.stringify({
  sections: [{ heading: 'Overview', body: 'A clear overview.' }, { heading: 'Leak', body: 'should be dropped' }],
  lockedTitles: ['Scope', 'Timeline', 'Investment', 'Why us', 'Next steps'],
});

function makeService(provider: LlmProvider, spend = 0) {
  const prisma: any = {
    llmConfig: { findFirst: async () => ({ orgId: null, provider: 'mock', model: 'mock', apiKeyEncrypted: 'enc' }) },
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
});
