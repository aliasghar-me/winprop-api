import { Inject, Injectable, Logger } from '@nestjs/common';
import { Profile, Job } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { LlmProvider } from './llm-provider.interface';
import { buildProposalPrompt, buildSectionPrompt, buildJobIntelligencePrompt, buildToneAdjustPrompt, PROPOSAL_SECTIONS, ProposalSection, ToneName } from './prompt.builder';
import { costUsd, PRICE_MAP_VERSION } from './pricing';
import { AppException } from '../common/errors/app-exception';

export const LLM_PROVIDERS = 'LLM_PROVIDERS';

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    @Inject(LLM_PROVIDERS) private providers: LlmProvider[],
  ) {}

  // Platform-funded spend circuit-breaker (security #1): cap total LLM cost per UTC
  // day so mass free signups can't run up an unbounded bill.
  private async assertPlatformBudget() {
    const cap = Number(process.env.LLM_DAILY_USD_CAP ?? 100);
    const start = new Date(); start.setUTCHours(0, 0, 0, 0);
    const agg = await this.prisma.generationLog.aggregate({ _sum: { costUsd: true }, where: { createdAt: { gte: start } } });
    if (Number(agg._sum.costUsd ?? 0) >= cap) throw new AppException(429, 'QUOTA_EXCEEDED', 'errors.platformBusy');
  }

  // Resolve the provider for a stored config. When LLM_MOCK=true the mock
  // provider (dev/demo only) takes over so the full pipeline can run without a
  // funded upstream key; otherwise the configured vendor is used.
  private resolveProvider(vendor: string): LlmProvider | undefined {
    if (process.env.LLM_MOCK === 'true') {
      const mock = this.providers.find((p) => p.vendor === 'mock');
      if (mock) return mock;
    }
    return this.providers.find((p) => p.vendor === vendor);
  }

  async generateProposal(profile: Profile & { profession?: string }, job: Job) {
    await this.assertPlatformBudget();
    const cfg = await this.prisma.llmConfig.findFirst({ where: { orgId: null } });
    if (!cfg) throw new AppException(503, 'LLM_NOT_CONFIGURED', 'errors.llmNotConfigured');
    const provider = this.resolveProvider(cfg.provider);
    if (!provider) throw new AppException(503, 'LLM_NOT_CONFIGURED', 'errors.llmProviderUnavailable', { provider: cfg.provider });
    const apiKey = this.crypto.decrypt(cfg.apiKeyEncrypted);
    const messages = buildProposalPrompt(profile, job);
    let result;
    try {
      result = await provider.generate(cfg.model, apiKey, messages);
    } catch (e: any) {
      // Log the upstream detail server-side; return a generic message (no provider/status leak, #15).
      this.logger.error(`LLM generate failed (${cfg.provider}/${cfg.model}): ${e?.message ?? e}`);
      throw new AppException(502, 'LLM_PROVIDER_ERROR', 'errors.llmGenerationFailed');
    }
    return {
      text: result.text,
      provider: cfg.provider,
      model: cfg.model,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      costUsd: costUsd(cfg.provider, cfg.model, result.promptTokens, result.completionTokens),
      priceMapVersion: PRICE_MAP_VERSION,
    };
  }

  // Job-Intelligence analysis: returns the raw JSON text + usage/cost (caller parses + persists).
  async analyzeJob(profile: Profile & { profession?: string }, job: Job) {
    await this.assertPlatformBudget();
    const cfg = await this.prisma.llmConfig.findFirst({ where: { orgId: null } });
    if (!cfg) throw new AppException(503, 'LLM_NOT_CONFIGURED', 'errors.llmNotConfigured');
    const provider = this.resolveProvider(cfg.provider);
    if (!provider) throw new AppException(503, 'LLM_NOT_CONFIGURED', 'errors.llmProviderUnavailable', { provider: cfg.provider });
    const apiKey = this.crypto.decrypt(cfg.apiKeyEncrypted);
    const messages = buildJobIntelligencePrompt(profile, job);
    let result;
    try {
      result = await provider.generate(cfg.model, apiKey, messages);
    } catch (e: any) {
      this.logger.error(`LLM analyzeJob failed (${cfg.provider}/${cfg.model}): ${e?.message ?? e}`);
      throw new AppException(502, 'LLM_PROVIDER_ERROR', 'errors.llmGenerationFailed');
    }
    return {
      text: result.text,
      provider: cfg.provider,
      model: cfg.model,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      costUsd: costUsd(cfg.provider, cfg.model, result.promptTokens, result.completionTokens),
      priceMapVersion: PRICE_MAP_VERSION,
    };
  }

  // Regenerate a single proposal section (cheaper than a full re-generation).
  // Returns the content key to patch and the new value, plus cost/usage metadata.
  async regenerateSection(
    profile: Profile & { profession?: string },
    job: Job,
    section: ProposalSection,
    current: Record<string, unknown>,
  ) {
    await this.assertPlatformBudget();
    const cfg = await this.prisma.llmConfig.findFirst({ where: { orgId: null } });
    if (!cfg) throw new AppException(503, 'LLM_NOT_CONFIGURED', 'errors.llmNotConfigured');
    const provider = this.resolveProvider(cfg.provider);
    if (!provider) throw new AppException(503, 'LLM_NOT_CONFIGURED', 'errors.llmProviderUnavailable', { provider: cfg.provider });
    const apiKey = this.crypto.decrypt(cfg.apiKeyEncrypted);
    const messages = buildSectionPrompt(profile, job, section, current);
    let result;
    try {
      result = await provider.generate(cfg.model, apiKey, messages);
    } catch (e: any) {
      this.logger.error(`LLM regenerate failed (${cfg.provider}/${cfg.model}): ${e?.message ?? e}`);
      throw new AppException(502, 'LLM_PROVIDER_ERROR', 'errors.llmGenerationFailed');
    }
    let value: unknown;
    try {
      value = JSON.parse(result.text)?.value;
    } catch {
      throw new AppException(502, 'LLM_PROVIDER_ERROR', 'errors.llmUnreadable');
    }
    if (value === undefined || value === null) throw new AppException(502, 'LLM_PROVIDER_ERROR', 'errors.llmIncomplete');
    return {
      key: PROPOSAL_SECTIONS[section].key,
      value,
      provider: cfg.provider,
      model: cfg.model,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      costUsd: costUsd(cfg.provider, cfg.model, result.promptTokens, result.completionTokens),
      priceMapVersion: PRICE_MAP_VERSION,
    };
  }

  // Re-run the prose sections (summary + closing) in a new tone — ONE LLM call so it
  // bills as a single generation. Returns the two new strings + usage metadata.
  async adjustToneProse(
    profile: Profile & { profession?: string },
    job: Job,
    tone: ToneName,
    current: Record<string, unknown>,
  ) {
    await this.assertPlatformBudget();
    const cfg = await this.prisma.llmConfig.findFirst({ where: { orgId: null } });
    if (!cfg) throw new AppException(503, 'LLM_NOT_CONFIGURED', 'errors.llmNotConfigured');
    const provider = this.resolveProvider(cfg.provider);
    if (!provider) throw new AppException(503, 'LLM_NOT_CONFIGURED', 'errors.llmProviderUnavailable', { provider: cfg.provider });
    const apiKey = this.crypto.decrypt(cfg.apiKeyEncrypted);
    const messages = buildToneAdjustPrompt(profile, job, tone, current);
    let result;
    try {
      result = await provider.generate(cfg.model, apiKey, messages);
    } catch (e: any) {
      this.logger.error(`LLM tone-adjust failed (${cfg.provider}/${cfg.model}): ${e?.message ?? e}`);
      throw new AppException(502, 'LLM_PROVIDER_ERROR', 'errors.llmGenerationFailed');
    }
    let parsed: { summary?: unknown; closing?: unknown };
    try {
      parsed = JSON.parse(result.text);
    } catch {
      throw new AppException(502, 'LLM_PROVIDER_ERROR', 'errors.llmUnreadable');
    }
    if (typeof parsed?.summary !== 'string' || typeof parsed?.closing !== 'string')
      throw new AppException(502, 'LLM_PROVIDER_ERROR', 'errors.llmIncomplete');
    return {
      summary: parsed.summary,
      closing: parsed.closing,
      provider: cfg.provider,
      model: cfg.model,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      costUsd: costUsd(cfg.provider, cfg.model, result.promptTokens, result.completionTokens),
      priceMapVersion: PRICE_MAP_VERSION,
    };
  }
}
