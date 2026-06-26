import { Inject, Injectable } from '@nestjs/common';
import { Profile, Job } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { LlmProvider } from './llm-provider.interface';
import { buildProposalPrompt, buildSectionPrompt, PROPOSAL_SECTIONS, ProposalSection } from './prompt.builder';
import { costUsd, PRICE_MAP_VERSION } from './pricing';
import { AppException } from '../common/errors/app-exception';

export const LLM_PROVIDERS = 'LLM_PROVIDERS';

@Injectable()
export class LlmService {
  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    @Inject(LLM_PROVIDERS) private providers: LlmProvider[],
  ) {}

  async generateProposal(profile: Profile & { profession?: string }, job: Job) {
    const cfg = await this.prisma.llmConfig.findFirst({ where: { orgId: null } });
    if (!cfg) throw new AppException(503, 'LLM_NOT_CONFIGURED', 'errors.llmNotConfigured');
    const provider = this.providers.find((p) => p.vendor === cfg.provider);
    if (!provider) throw new AppException(503, 'LLM_NOT_CONFIGURED', 'errors.llmProviderUnavailable', { provider: cfg.provider });
    const apiKey = this.crypto.decrypt(cfg.apiKeyEncrypted);
    const messages = buildProposalPrompt(profile, job);
    let result;
    try {
      result = await provider.generate(cfg.model, apiKey, messages);
    } catch (e: any) {
      throw new AppException(502, 'LLM_PROVIDER_ERROR', 'errors.llmGenerationFailed', { message: e.message });
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
    const cfg = await this.prisma.llmConfig.findFirst({ where: { orgId: null } });
    if (!cfg) throw new AppException(503, 'LLM_NOT_CONFIGURED', 'errors.llmNotConfigured');
    const provider = this.providers.find((p) => p.vendor === cfg.provider);
    if (!provider) throw new AppException(503, 'LLM_NOT_CONFIGURED', 'errors.llmProviderUnavailable', { provider: cfg.provider });
    const apiKey = this.crypto.decrypt(cfg.apiKeyEncrypted);
    const messages = buildSectionPrompt(profile, job, section, current);
    let result;
    try {
      result = await provider.generate(cfg.model, apiKey, messages);
    } catch (e: any) {
      throw new AppException(502, 'LLM_PROVIDER_ERROR', 'errors.llmGenerationFailed', { message: e.message });
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
}
