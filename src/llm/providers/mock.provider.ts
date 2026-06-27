import { Injectable } from '@nestjs/common';
import { LlmProvider, LlmMessages, LlmResult } from '../llm-provider.interface';

/**
 * Dev/demo-only provider. Registered ONLY when LLM_MOCK=true (see LlmModule),
 * so it can never serve traffic in a normally-configured production deployment.
 * Returns deterministic, well-formed proposal JSON so the full
 * generate → persist → render → export pipeline can be exercised and demoed
 * without a funded upstream LLM key.
 */
@Injectable()
export class MockProvider implements LlmProvider {
  readonly vendor = 'mock' as const;

  async generate(_model: string, _apiKey: string, messages: LlmMessages): Promise<LlmResult> {
    const job = /job "([^"]+)"/.exec(messages.user)?.[1] ?? 'the project';
    const client = /client: ([^)]+)\)/.exec(messages.user)?.[1] ?? 'the client';

    // Per-section regenerate path asks for a single "value" key.
    const section = /Regenerate ONLY the "([^"]+)" section/.exec(messages.user)?.[1];
    if (section) {
      const value = this.sectionValue(section, job, client);
      return this.result(JSON.stringify({ value }));
    }

    // Full-proposal path.
    const proposal = {
      summary:
        `${client} needs a partner who can deliver ${job} with clarity and momentum. ` +
        `This proposal outlines a focused engagement that ships measurable outcomes while keeping you involved at every milestone.`,
      scope: [
        'Discovery & requirements alignment workshop',
        'Architecture and technical approach sign-off',
        'Iterative build with weekly demo checkpoints',
        'QA, accessibility and performance hardening',
        'Launch support and a 2-week stabilisation window',
      ],
      timelineWeeks: 8,
      priceUsd: 32000,
      closing:
        `We're excited about the opportunity to help ${client} succeed with ${job}. ` +
        `Once you approve this proposal we can kick off discovery within a week.`,
    };
    return this.result(JSON.stringify(proposal));
  }

  private sectionValue(section: string, job: string, client: string): unknown {
    switch (section) {
      case 'summary':
        return `${client} is looking for a confident partner to deliver ${job}. This engagement is built around clear milestones and visible progress.`;
      case 'scope':
        return ['Discovery & alignment', 'Iterative build with weekly demos', 'QA & accessibility', 'Launch & stabilisation'];
      case 'timeline':
        return 8;
      case 'pricing':
        return 32000;
      case 'closing':
        return `We'd love to help ${client} ship ${job}. Approve this proposal and we'll start discovery within a week.`;
      default:
        return `Updated ${section}.`;
    }
  }

  private result(text: string): LlmResult {
    return { text, promptTokens: 600, completionTokens: 300 };
  }
}
