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
    const job = /job "([^"]+)"/.exec(messages.user)?.[1] ?? /Title: (.+)/.exec(messages.user)?.[1] ?? 'the project';
    const client = /client: ([^)]+)\)/.exec(messages.user)?.[1] ?? 'the client';

    // Job-Intelligence analysis path.
    if (messages.user.includes('Return JSON with keys: objective')) {
      const analysis = {
        objective: `Deliver ${job} with a modern, reliable build and a smooth launch.`,
        domain: 'Web / SaaS',
        seniority: 'Senior',
        complexity: 'Medium',
        estimatedWeeks: 8,
        estimatedBudgetUsd: 32000,
        stack: ['Next.js', 'TypeScript', 'PostgreSQL', 'Tailwind CSS'],
        deliverables: ['Discovery & specification', 'Design system & UI', 'Core build', 'QA & accessibility', 'Launch & handover'],
        integrations: ['Auth provider', 'Payments', 'Analytics'],
        risks: [
          { title: 'Scope ambiguity', severity: 'medium', note: 'Several requirements are implied rather than stated — confirm before fixing the price.' },
          { title: 'Timeline pressure', severity: 'low', note: 'Stated timeline is achievable if discovery starts promptly.' },
        ],
        clarificationQuestions: [
          'What does success look like 90 days after launch?',
          'Are there existing brand or design assets to work from?',
          'Which integrations are must-have for v1 vs later?',
          'Who is the decision-maker and what is the approval process?',
          'Is the stated budget fixed or flexible for the right approach?',
        ],
        winProbability: {
          score: 72,
          reasons: ['Strong overlap between the brief and your core skills', 'Budget sits within your typical range'],
          improvements: ['Lead with a directly comparable case study', 'Answer the top clarification question in your opening'],
        },
      };
      return this.result(JSON.stringify(analysis));
    }

    // Per-section regenerate path asks for a single "value" key.
    const section = /Regenerate ONLY the "([^"]+)" section/.exec(messages.user)?.[1];
    if (section) {
      const value = this.sectionValue(section, job, client);
      return this.result(JSON.stringify({ value }));
    }

    // Landing-funnel preview path.
    if (messages.user.includes('sections (array of exactly ONE object')) {
      const previewTitle = /Project title: (.+)/.exec(messages.user)?.[1] ?? 'your project';
      const preview = {
        sections: [{
          heading: 'Overview',
          body: `You're setting out to deliver ${previewTitle}, and the priority is a build that's clear, credible, and on-brand from day one. ` +
                `This engagement is structured around focused milestones and visible progress, so you always know what's shipping next.`,
        }],
        lockedTitles: ['Scope of work', 'Timeline', 'Investment', 'Why us', 'Next steps'],
      };
      return this.result(JSON.stringify(preview));
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
