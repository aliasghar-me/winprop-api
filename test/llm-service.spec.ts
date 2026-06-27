import { LlmService } from '../src/llm/llm.service';

describe('LlmService', () => {
  const cfg = { provider: 'anthropic', model: 'claude-opus-4-8', apiKeyEncrypted: 'enc' };
  // generationLog.aggregate backs the platform spend circuit-breaker (assertPlatformBudget).
  const genLog = { aggregate: jest.fn().mockResolvedValue({ _sum: { costUsd: 0 } }) };
  const prisma: any = { llmConfig: { findFirst: jest.fn().mockResolvedValue(cfg) }, generationLog: genLog };
  const crypto: any = { decrypt: jest.fn().mockReturnValue('real-key') };
  const provider: any = { vendor: 'anthropic', generate: jest.fn().mockResolvedValue({ text: '{"summary":"x"}', promptTokens: 100, completionTokens: 200 }) };

  it('throws LLM_NOT_CONFIGURED when no global config', async () => {
    const p2: any = { llmConfig: { findFirst: jest.fn().mockResolvedValue(null) }, generationLog: genLog };
    const svc = new LlmService(p2, crypto, [provider]);
    await expect(svc.generateProposal({} as any, {} as any)).rejects.toMatchObject({ code: 'LLM_NOT_CONFIGURED' });
  });

  it('decrypts key, calls provider, returns result + cost', async () => {
    const svc = new LlmService(prisma, crypto, [provider]);
    const r = await svc.generateProposal(
      { agencyName: 'A', services: [], skills: [], tone: 'premium', priceMin: 1, priceMax: 2 } as any,
      { title: 'J', company: 'C' } as any);
    expect(crypto.decrypt).toHaveBeenCalledWith('enc');
    expect(provider.generate).toHaveBeenCalled();
    expect(r.text).toContain('summary');
    expect(r.costUsd).toBeGreaterThan(0);
  });
});
