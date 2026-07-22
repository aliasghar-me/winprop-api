import { LlmService } from '../src/llm/llm.service';
import { AppException } from '../src/common/errors/app-exception';
import type { LlmProvider, LlmMessages, LlmResult } from '../src/llm/llm-provider.interface';

// --- Fakes ------------------------------------------------------------------
// House pattern: construct LlmService directly with hand-rolled fakes. No Nest
// DI, no Postgres. See test/llm-service.spec.ts + test/generate-preview.spec.ts.

const PRICED = { provider: 'anthropic', model: 'claude-opus-4-8' }; // has a pricing entry

function makeService(
  provider: LlmProvider | undefined,
  opts: { cfg?: any; platformSpend?: number } = {},
) {
  const cfg =
    opts.cfg === null
      ? null
      : {
          orgId: null,
          provider: opts.cfg?.provider ?? PRICED.provider,
          model: opts.cfg?.model ?? PRICED.model,
          apiKeyEncrypted: 'enc',
        };
  const prisma: any = {
    llmConfig: { findFirst: async () => cfg },
    generationLog: {
      aggregate: async () => ({ _sum: { costUsd: opts.platformSpend ?? 0 } }),
    },
  };
  const crypto: any = { decrypt: (x: string) => x };
  const providers = provider ? [provider] : [];
  return new LlmService(prisma, crypto, providers);
}

// A provider that returns a fixed text (and records usage so costUsd > 0).
const okProvider = (text: string, vendor: LlmProvider['vendor'] = 'anthropic'): LlmProvider => ({
  vendor,
  async generate(_m: string, _k: string, _msg: LlmMessages): Promise<LlmResult> {
    return { text, promptTokens: 100, completionTokens: 50 };
  },
});

// A provider whose generate() throws an Error (upstream failure).
const throwingProvider = (vendor: LlmProvider['vendor'] = 'anthropic'): LlmProvider => ({
  vendor,
  async generate(): Promise<LlmResult> {
    throw new Error('upstream boom');
  },
});

// A provider that throws a NON-Error (bare string) — exercises the `e?.message ?? e`
// fallback branch in each catch block's logger call.
const stringThrowProvider = (vendor: LlmProvider['vendor'] = 'anthropic'): LlmProvider => ({
  vendor,
  async generate(): Promise<LlmResult> {
    throw 'bare string failure';
  },
});

// Minimal Profile/Job shaped objects — only the fields the prompt builders read.
const profile: any = {
  agencyName: 'Acme',
  profession: 'design',
  tone: 'premium',
  priceMin: 1000,
  priceMax: 5000,
  services: ['web', 'brand'],
  skills: ['react', 'figma'],
  caseStudies: [{ title: 'Case', summary: 'Good' }],
  testimonials: [{ author: 'Jo', company: 'Co', quote: 'Great' }],
  portfolioLinks: ['https://x.test'],
  website: 'https://acme.test',
};
const job: any = {
  title: 'Landing page',
  company: 'BigCo',
  projectDescription: 'Build a marketing site',
  requirements: 'Fast + accessible',
  budget: 4000,
  timeline: '6 weeks',
  intelligenceJson: {
    objective: 'launch',
    complexity: 'Medium',
    estimatedWeeks: 6,
    estimatedBudgetUsd: 4000,
    stack: ['react'],
    deliverables: ['site'],
    risks: [{ title: 'scope creep' }],
  },
};

const okValue = JSON.stringify({ value: 'regenerated' });
const okTone = JSON.stringify({ summary: 'new summary', closing: 'new closing' });

// Helper: run an async fn and return the thrown AppException (or fail).
async function grab(fn: () => Promise<unknown>): Promise<AppException> {
  try {
    await fn();
  } catch (e) {
    return e as AppException;
  }
  throw new Error('expected the call to throw, but it resolved');
}

// Env isolation — these tests toggle caps and LLM_MOCK.
const ENV_KEYS = ['LLM_MOCK', 'LLM_DAILY_USD_CAP', 'LLM_ANON_DAILY_USD_CAP'];
let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  delete process.env.LLM_MOCK; // default: resolve provider by vendor match
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

// ---------------------------------------------------------------------------
// generateProposal
// ---------------------------------------------------------------------------
describe('LlmService.extractMemories', () => {
  it('parses durable facts from provider JSON', async () => {
    const svc = makeService(okProvider('{"facts":[{"category":"technical","key":"stack","value":"Next.js","confidence":0.9}]}'));
    expect(await svc.extractMemories('I build with Next.js')).toEqual([{ category: 'technical', key: 'stack', value: 'Next.js', confidence: 0.9 }]);
  });
  it('returns [] on non-JSON output', async () => {
    expect(await makeService(okProvider('not json')).extractMemories('x')).toEqual([]);
  });
  it('returns [] when there is no LLM config', async () => {
    expect(await makeService(okProvider('{"facts":[]}'), { cfg: null }).extractMemories('x')).toEqual([]);
  });
  it('returns [] when the configured provider cannot be resolved', async () => {
    // config says anthropic but only an openai provider is registered → resolveProvider undefined
    const svc = makeService(okProvider('{"facts":[]}', 'openai'), { cfg: { provider: 'anthropic', model: 'claude-opus-4-8' } });
    expect(await svc.extractMemories('x')).toEqual([]);
  });
  it('returns [] when parsed.facts is absent / not an array', async () => {
    // valid JSON but no `facts` array → Array.isArray(...) false branch → []
    expect(await makeService(okProvider('{"notFacts":1}')).extractMemories('x')).toEqual([]);
  });
  it('defaults category, clamps confidence, and drops facts missing key/value', async () => {
    const svc = makeService(okProvider('{"facts":[{"key":"k","value":"v"},{"value":"no key"},{"key":"c","value":"x","category":"business","confidence":5}]}'));
    expect(await svc.extractMemories('x')).toEqual([
      { category: 'general', key: 'k', value: 'v', confidence: 0.7 },
      { category: 'business', key: 'c', value: 'x', confidence: 1 },
    ]);
  });
});

describe('LlmService.generateProposal', () => {
  it('happy path: decrypts key, calls provider, returns text + metadata + cost', async () => {
    const svc = makeService(okProvider('{"summary":"x"}'));
    const r = await svc.generateProposal(profile, job);
    expect(r.text).toContain('summary');
    expect(r.provider).toBe(PRICED.provider);
    expect(r.model).toBe(PRICED.model);
    expect(r.promptTokens).toBe(100);
    expect(r.completionTokens).toBe(50);
    expect(r.costUsd).toBeGreaterThan(0);
    expect(r.priceMapVersion).toBeDefined();
  });

  it('503 LLM_NOT_CONFIGURED when no global config', async () => {
    const svc = makeService(okProvider('{}'), { cfg: null });
    const e = await grab(() => svc.generateProposal(profile, job));
    expect(e).toBeInstanceOf(AppException);
    expect(e.code).toBe('LLM_NOT_CONFIGURED');
    expect(e.getStatus()).toBe(503);
  });

  it('503 when provider cannot be resolved', async () => {
    const svc = makeService(okProvider('{}', 'openai'), { cfg: { provider: 'anthropic', model: 'claude-opus-4-8' } });
    const e = await grab(() => svc.generateProposal(profile, job));
    expect(e.code).toBe('LLM_NOT_CONFIGURED');
    expect(e.getStatus()).toBe(503);
    expect(e.translationKey).toBe('errors.llmProviderUnavailable');
  });

  it('502 LLM_PROVIDER_ERROR when provider.generate throws', async () => {
    const svc = makeService(throwingProvider());
    const e = await grab(() => svc.generateProposal(profile, job));
    expect(e.code).toBe('LLM_PROVIDER_ERROR');
    expect(e.getStatus()).toBe(502);
  });

  it('429 QUOTA_EXCEEDED when platform daily USD cap is reached', async () => {
    process.env.LLM_DAILY_USD_CAP = '5';
    const svc = makeService(okProvider('{}'), { platformSpend: 5 });
    const e = await grab(() => svc.generateProposal(profile, job));
    expect(e.code).toBe('QUOTA_EXCEEDED');
    expect(e.getStatus()).toBe(429);
  });

  it('uses the default platform cap (100) when env unset — under it succeeds', async () => {
    delete process.env.LLM_DAILY_USD_CAP;
    const svc = makeService(okProvider('{}'), { platformSpend: 50 });
    await expect(svc.generateProposal(profile, job)).resolves.toBeDefined();
  });

  it('anon path: enforces + records the anon daily cap (opts.anon true)', async () => {
    delete process.env.LLM_DAILY_USD_CAP;
    process.env.LLM_ANON_DAILY_USD_CAP = '1000'; // well above one call's cost
    const svc = makeService(okProvider('{"summary":"x"}'));
    const r = await svc.generateProposal(profile, job, [], { anon: true });
    expect(r.text).toContain('summary'); // succeeded → assertAnonBudget + recordAnonSpend both ran
  });

  it('anon path: 429 when the anon daily cap is already exhausted', async () => {
    delete process.env.LLM_DAILY_USD_CAP;
    process.env.LLM_ANON_DAILY_USD_CAP = '0'; // cap 0 → any prior/zero spend >= cap → reject
    const svc = makeService(okProvider('{"summary":"x"}'));
    const e = await grab(() => svc.generateProposal(profile, job, [], { anon: true }));
    expect(e.code).toBe('QUOTA_EXCEEDED');
    expect(e.getStatus()).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// analyzeJob (same shape as generateProposal — raw text, no JSON parse)
// ---------------------------------------------------------------------------
describe('LlmService.analyzeJob', () => {
  it('happy path returns raw text + cost', async () => {
    const svc = makeService(okProvider('{"objective":"x"}'));
    const r = await svc.analyzeJob(profile, job);
    expect(r.text).toContain('objective');
    expect(r.costUsd).toBeGreaterThan(0);
  });

  it('anon path: enforces + records the anon daily cap (opts.anon true)', async () => {
    delete process.env.LLM_DAILY_USD_CAP;
    process.env.LLM_ANON_DAILY_USD_CAP = '1000';
    const svc = makeService(okProvider('{"objective":"x"}'));
    const r = await svc.analyzeJob(profile, job, [], { anon: true });
    expect(r.text).toContain('objective');
  });

  it('anon path: 429 when the anon daily cap is already exhausted', async () => {
    delete process.env.LLM_DAILY_USD_CAP;
    process.env.LLM_ANON_DAILY_USD_CAP = '0';
    const svc = makeService(okProvider('{"objective":"x"}'));
    const e = await grab(() => svc.analyzeJob(profile, job, [], { anon: true }));
    expect(e.code).toBe('QUOTA_EXCEEDED');
  });

  it('503 when no config', async () => {
    const e = await grab(() => makeService(okProvider('{}'), { cfg: null }).analyzeJob(profile, job));
    expect(e.code).toBe('LLM_NOT_CONFIGURED');
  });

  it('503 when provider unresolved', async () => {
    const svc = makeService(okProvider('{}', 'openai'), { cfg: { provider: 'anthropic', model: 'claude-opus-4-8' } });
    const e = await grab(() => svc.analyzeJob(profile, job));
    expect(e.code).toBe('LLM_NOT_CONFIGURED');
  });

  it('502 when provider throws', async () => {
    const e = await grab(() => makeService(throwingProvider()).analyzeJob(profile, job));
    expect(e.code).toBe('LLM_PROVIDER_ERROR');
  });

  it('429 when platform cap reached', async () => {
    process.env.LLM_DAILY_USD_CAP = '1';
    const e = await grab(() => makeService(okProvider('{}'), { platformSpend: 2 }).analyzeJob(profile, job));
    expect(e.code).toBe('QUOTA_EXCEEDED');
  });
});

// ---------------------------------------------------------------------------
// regenerateSection (parses JSON -> .value)
// ---------------------------------------------------------------------------
describe('LlmService.regenerateSection', () => {
  it('happy path returns key + parsed value', async () => {
    const svc = makeService(okProvider(okValue));
    const r = await svc.regenerateSection(profile, job, 'summary', { summary: 'old' });
    expect(r.key).toBe('summary');
    expect(r.value).toBe('regenerated');
    expect(r.costUsd).toBeGreaterThan(0);
  });

  it('maps section name to its content key (pricing -> priceUsd)', async () => {
    const svc = makeService(okProvider(JSON.stringify({ value: 3000 })));
    const r = await svc.regenerateSection(profile, job, 'pricing', {});
    expect(r.key).toBe('priceUsd');
    expect(r.value).toBe(3000);
  });

  it('503 when no config', async () => {
    const e = await grab(() => makeService(okProvider(okValue), { cfg: null }).regenerateSection(profile, job, 'summary', {}));
    expect(e.code).toBe('LLM_NOT_CONFIGURED');
  });

  it('503 when provider unresolved', async () => {
    const svc = makeService(okProvider(okValue, 'openai'), { cfg: { provider: 'anthropic', model: 'claude-opus-4-8' } });
    const e = await grab(() => svc.regenerateSection(profile, job, 'summary', {}));
    expect(e.code).toBe('LLM_NOT_CONFIGURED');
  });

  it('502 when provider throws', async () => {
    const e = await grab(() => makeService(throwingProvider()).regenerateSection(profile, job, 'summary', {}));
    expect(e.code).toBe('LLM_PROVIDER_ERROR');
    expect(e.translationKey).toBe('errors.llmGenerationFailed');
  });

  it('502 llmUnreadable on non-JSON output', async () => {
    const e = await grab(() => makeService(okProvider('not json')).regenerateSection(profile, job, 'summary', {}));
    expect(e.code).toBe('LLM_PROVIDER_ERROR');
    expect(e.translationKey).toBe('errors.llmUnreadable');
  });

  it('502 llmIncomplete when value is undefined', async () => {
    const e = await grab(() => makeService(okProvider('{"nope":1}')).regenerateSection(profile, job, 'summary', {}));
    expect(e.translationKey).toBe('errors.llmIncomplete');
  });

  it('502 llmIncomplete when value is null', async () => {
    const e = await grab(() => makeService(okProvider('{"value":null}')).regenerateSection(profile, job, 'summary', {}));
    expect(e.translationKey).toBe('errors.llmIncomplete');
  });

  it('429 when platform cap reached', async () => {
    process.env.LLM_DAILY_USD_CAP = '1';
    const e = await grab(() => makeService(okProvider(okValue), { platformSpend: 5 }).regenerateSection(profile, job, 'summary', {}));
    expect(e.code).toBe('QUOTA_EXCEEDED');
  });
});

// ---------------------------------------------------------------------------
// generateDoc (raw text, no JSON parse)
// ---------------------------------------------------------------------------
describe('LlmService.generateDoc', () => {
  it('happy path returns raw text + cost', async () => {
    const svc = makeService(okProvider('{"overview":"x"}'));
    const r = await svc.generateDoc(profile, job, 'sow');
    expect(r.text).toContain('overview');
    expect(r.costUsd).toBeGreaterThan(0);
  });

  it('works for the estimate template too', async () => {
    const svc = makeService(okProvider('{"summary":"x"}'));
    const r = await svc.generateDoc(profile, job, 'estimate');
    expect(r.provider).toBe(PRICED.provider);
  });

  it('503 when no config', async () => {
    const e = await grab(() => makeService(okProvider('{}'), { cfg: null }).generateDoc(profile, job, 'sow'));
    expect(e.code).toBe('LLM_NOT_CONFIGURED');
  });

  it('503 when provider unresolved', async () => {
    const svc = makeService(okProvider('{}', 'openai'), { cfg: { provider: 'anthropic', model: 'claude-opus-4-8' } });
    const e = await grab(() => svc.generateDoc(profile, job, 'sow'));
    expect(e.code).toBe('LLM_NOT_CONFIGURED');
  });

  it('502 when provider throws', async () => {
    const e = await grab(() => makeService(throwingProvider()).generateDoc(profile, job, 'sow'));
    expect(e.code).toBe('LLM_PROVIDER_ERROR');
  });

  it('429 when platform cap reached', async () => {
    process.env.LLM_DAILY_USD_CAP = '0';
    const e = await grab(() => makeService(okProvider('{}')).generateDoc(profile, job, 'sow'));
    expect(e.code).toBe('QUOTA_EXCEEDED');
  });
});

// ---------------------------------------------------------------------------
// regenerateDocField (parses JSON -> .value)
// ---------------------------------------------------------------------------
describe('LlmService.regenerateDocField', () => {
  it('happy path returns fieldKey + parsed value', async () => {
    const svc = makeService(okProvider(okValue));
    const r = await svc.regenerateDocField(profile, job, 'sow', 'overview', { overview: 'old' });
    expect(r.key).toBe('overview');
    expect(r.value).toBe('regenerated');
    expect(r.costUsd).toBeGreaterThan(0);
  });

  it('503 when no config', async () => {
    const e = await grab(() => makeService(okProvider(okValue), { cfg: null }).regenerateDocField(profile, job, 'sow', 'overview', {}));
    expect(e.code).toBe('LLM_NOT_CONFIGURED');
  });

  it('503 when provider unresolved', async () => {
    const svc = makeService(okProvider(okValue, 'openai'), { cfg: { provider: 'anthropic', model: 'claude-opus-4-8' } });
    const e = await grab(() => svc.regenerateDocField(profile, job, 'sow', 'overview', {}));
    expect(e.code).toBe('LLM_NOT_CONFIGURED');
  });

  it('502 when provider throws', async () => {
    const e = await grab(() => makeService(throwingProvider()).regenerateDocField(profile, job, 'sow', 'overview', {}));
    expect(e.code).toBe('LLM_PROVIDER_ERROR');
  });

  it('502 llmUnreadable on non-JSON output', async () => {
    const e = await grab(() => makeService(okProvider('nope')).regenerateDocField(profile, job, 'sow', 'overview', {}));
    expect(e.translationKey).toBe('errors.llmUnreadable');
  });

  it('502 llmIncomplete when value missing', async () => {
    const e = await grab(() => makeService(okProvider('{"x":1}')).regenerateDocField(profile, job, 'sow', 'overview', {}));
    expect(e.translationKey).toBe('errors.llmIncomplete');
  });

  it('429 when platform cap reached', async () => {
    process.env.LLM_DAILY_USD_CAP = '1';
    const e = await grab(() => makeService(okProvider(okValue), { platformSpend: 3 }).regenerateDocField(profile, job, 'sow', 'overview', {}));
    expect(e.code).toBe('QUOTA_EXCEEDED');
  });
});

// ---------------------------------------------------------------------------
// adjustToneProse (parses JSON -> {summary, closing})
// ---------------------------------------------------------------------------
describe('LlmService.adjustToneProse', () => {
  it('happy path returns rewritten summary + closing', async () => {
    const svc = makeService(okProvider(okTone));
    const r = await svc.adjustToneProse(profile, job, 'formal', { summary: 'old', closing: 'bye' });
    expect(r.summary).toBe('new summary');
    expect(r.closing).toBe('new closing');
    expect(r.costUsd).toBeGreaterThan(0);
  });

  it('503 when no config', async () => {
    const e = await grab(() => makeService(okProvider(okTone), { cfg: null }).adjustToneProse(profile, job, 'formal', {}));
    expect(e.code).toBe('LLM_NOT_CONFIGURED');
  });

  it('503 when provider unresolved', async () => {
    const svc = makeService(okProvider(okTone, 'openai'), { cfg: { provider: 'anthropic', model: 'claude-opus-4-8' } });
    const e = await grab(() => svc.adjustToneProse(profile, job, 'formal', {}));
    expect(e.code).toBe('LLM_NOT_CONFIGURED');
  });

  it('502 when provider throws', async () => {
    const e = await grab(() => makeService(throwingProvider()).adjustToneProse(profile, job, 'formal', {}));
    expect(e.code).toBe('LLM_PROVIDER_ERROR');
  });

  it('502 llmUnreadable on non-JSON output', async () => {
    const e = await grab(() => makeService(okProvider('nope')).adjustToneProse(profile, job, 'formal', {}));
    expect(e.translationKey).toBe('errors.llmUnreadable');
  });

  it('502 llmIncomplete when summary is not a string', async () => {
    const e = await grab(() => makeService(okProvider(JSON.stringify({ summary: 1, closing: 'x' }))).adjustToneProse(profile, job, 'formal', {}));
    expect(e.translationKey).toBe('errors.llmIncomplete');
  });

  it('502 llmIncomplete when closing is missing', async () => {
    const e = await grab(() => makeService(okProvider(JSON.stringify({ summary: 'x' }))).adjustToneProse(profile, job, 'premium', {}));
    expect(e.translationKey).toBe('errors.llmIncomplete');
  });

  it('429 when platform cap reached', async () => {
    process.env.LLM_DAILY_USD_CAP = '1';
    const e = await grab(() => makeService(okProvider(okTone), { platformSpend: 9 }).adjustToneProse(profile, job, 'casual', {}));
    expect(e.code).toBe('QUOTA_EXCEEDED');
  });
});

// ---------------------------------------------------------------------------
// resolveProvider — LLM_MOCK branch coverage
// ---------------------------------------------------------------------------
describe('LlmService.resolveProvider (LLM_MOCK)', () => {
  it('prefers the mock provider when LLM_MOCK=true and one is present', async () => {
    process.env.LLM_MOCK = 'true';
    // Config points at openai, but only a mock provider is injected. With LLM_MOCK
    // the mock takes over so the pipeline still runs.
    const mock = okProvider('{"summary":"m"}', 'mock');
    const svc = makeService(mock, { cfg: { provider: 'openai', model: 'gpt-4o' } });
    const r = await svc.generateProposal(profile, job);
    expect(r.text).toContain('summary');
    expect(r.provider).toBe('openai'); // metadata still reflects the stored config
  });

  it('falls back to vendor match when LLM_MOCK=true but no mock provider exists', async () => {
    process.env.LLM_MOCK = 'true';
    // No mock in the array — resolveProvider falls through to the configured vendor.
    const svc = makeService(okProvider('{"summary":"a"}', 'anthropic'));
    const r = await svc.generateProposal(profile, job);
    expect(r.text).toContain('summary');
  });
});

// ---------------------------------------------------------------------------
// Logger fallback branch: provider throws a non-Error (covers `e?.message ?? e`)
// ---------------------------------------------------------------------------
describe('LlmService — non-Error upstream failures still map to 502', () => {
  it('generateProposal', async () => {
    const e = await grab(() => makeService(stringThrowProvider()).generateProposal(profile, job));
    expect(e.code).toBe('LLM_PROVIDER_ERROR');
  });
  it('analyzeJob', async () => {
    const e = await grab(() => makeService(stringThrowProvider()).analyzeJob(profile, job));
    expect(e.code).toBe('LLM_PROVIDER_ERROR');
  });
  it('regenerateSection', async () => {
    const e = await grab(() => makeService(stringThrowProvider()).regenerateSection(profile, job, 'summary', {}));
    expect(e.code).toBe('LLM_PROVIDER_ERROR');
  });
  it('generateDoc', async () => {
    const e = await grab(() => makeService(stringThrowProvider()).generateDoc(profile, job, 'sow'));
    expect(e.code).toBe('LLM_PROVIDER_ERROR');
  });
  it('regenerateDocField', async () => {
    const e = await grab(() => makeService(stringThrowProvider()).regenerateDocField(profile, job, 'sow', 'overview', {}));
    expect(e.code).toBe('LLM_PROVIDER_ERROR');
  });
  it('adjustToneProse', async () => {
    const e = await grab(() => makeService(stringThrowProvider()).adjustToneProse(profile, job, 'formal', {}));
    expect(e.code).toBe('LLM_PROVIDER_ERROR');
  });
  it('generatePreview', async () => {
    const e = await grab(() => makeService(stringThrowProvider()).generatePreview('t', 'd'));
    expect(e.code).toBe('LLM_PROVIDER_ERROR');
  });
});

// ---------------------------------------------------------------------------
// generatePreview — error/branch coverage not exercised by generate-preview.spec.ts
// ---------------------------------------------------------------------------
describe('LlmService.generatePreview (branches)', () => {
  const okPreview = JSON.stringify({
    sections: [{ heading: 'Overview', body: 'Body' }],
    lockedTitles: ['Scope', 'Timeline'],
  });

  it('503 LLM_NOT_CONFIGURED when no config', async () => {
    const e = await grab(() => makeService(okProvider(okPreview), { cfg: null }).generatePreview('t', 'd'));
    expect(e.code).toBe('LLM_NOT_CONFIGURED');
    expect(e.getStatus()).toBe(503);
  });

  it('503 when provider cannot be resolved', async () => {
    const svc = makeService(okProvider(okPreview, 'openai'), { cfg: { provider: 'anthropic', model: 'claude-opus-4-8' } });
    const e = await grab(() => svc.generatePreview('t', 'd'));
    expect(e.code).toBe('LLM_NOT_CONFIGURED');
  });

  it('502 LLM_PROVIDER_ERROR when provider throws', async () => {
    const e = await grab(() => makeService(throwingProvider()).generatePreview('t', 'd'));
    expect(e.code).toBe('LLM_PROVIDER_ERROR');
    expect(e.getStatus()).toBe(502);
  });

  it('502 llmIncomplete when sections is not an array', async () => {
    const e = await grab(() => makeService(okProvider(JSON.stringify({ sections: 'nope', lockedTitles: [] }))).generatePreview('t', 'd'));
    expect(e.translationKey).toBe('errors.llmIncomplete');
  });

  it('502 llmIncomplete when all section entries are malformed', async () => {
    const bad = JSON.stringify({ sections: [{ heading: 1 }, { body: 2 }, null], lockedTitles: ['Scope'] });
    const e = await grab(() => makeService(okProvider(bad)).generatePreview('t', 'd'));
    expect(e.translationKey).toBe('errors.llmIncomplete');
  });

  it('defaults lockedTitles to [] when not an array', async () => {
    const svc = makeService(okProvider(JSON.stringify({ sections: [{ heading: 'H', body: 'B' }], lockedTitles: 'nope' })));
    const out = await svc.generatePreview('t', 'd');
    expect(out.sections).toHaveLength(1);
    expect(out.lockedTitles).toEqual([]);
  });

  it('drops non-string lockedTitles and truncates long heading/body', async () => {
    const longHeading = 'H'.repeat(500);
    const longBody = 'B'.repeat(5000);
    const svc = makeService(
      okProvider(JSON.stringify({ sections: [{ heading: longHeading, body: longBody }], lockedTitles: ['Scope', 5, 'Timeline'] })),
    );
    const out = await svc.generatePreview('t', 'd');
    expect(out.sections[0].heading).toHaveLength(200);
    expect(out.sections[0].body).toHaveLength(2000);
    expect(out.lockedTitles).toEqual(['Scope', 'Timeline']);
  });

  it('429 when the platform cap is reached (before the anon cap)', async () => {
    process.env.LLM_DAILY_USD_CAP = '0';
    const e = await grab(() => makeService(okProvider(okPreview)).generatePreview('t', 'd'));
    expect(e.code).toBe('QUOTA_EXCEEDED');
  });
});

// ---------------------------------------------------------------------------
// assertPlatformBudget — nullish aggregate handling
// ---------------------------------------------------------------------------
describe('LlmService.assertPlatformBudget (null aggregate)', () => {
  it('treats a null _sum.costUsd as 0 spend and proceeds', async () => {
    // Genuine null aggregate (bypasses makeService's platformSpend ?? 0 coalescing)
    // to exercise the `agg._sum.costUsd ?? 0` fallback in assertPlatformBudget.
    const prisma: any = {
      llmConfig: { findFirst: async () => ({ orgId: null, ...PRICED, apiKeyEncrypted: 'enc' }) },
      generationLog: { aggregate: async () => ({ _sum: { costUsd: null } }) },
    };
    const crypto: any = { decrypt: (x: string) => x };
    const svc = new LlmService(prisma, crypto, [okProvider('{"summary":"x"}')]);
    await expect(svc.generateProposal(profile, job)).resolves.toBeDefined();
  });
});
