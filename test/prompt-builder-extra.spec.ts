import {
  analysisContext,
  proofContext,
  memoryContext,
  buildJobIntelligencePrompt,
  buildMemoryExtractionPrompt,
  buildToneAdjustPrompt,
  buildSectionPrompt,
  buildProposalPrompt,
  PROPOSAL_SECTIONS,
  TONES,
} from '../src/llm/prompt.builder';

describe('memoryContext', () => {
  it('returns empty for no facts and renders known facts otherwise', () => {
    expect(memoryContext([])).toBe('');
    expect(memoryContext(undefined)).toBe('');
    const out = memoryContext([
      { category: 'technical', key: 'framework', value: 'Next.js' },
      { category: '', key: 'rate', value: '$80/hr' },
    ]);
    expect(out).toContain('already know');
    expect(out).toContain('technical/framework: Next.js');
    expect(out).toContain('rate: $80/hr');
  });
});

describe('buildMemoryExtractionPrompt', () => {
  it('asks for durable freelancer facts as JSON', () => {
    const { system, user } = buildMemoryExtractionPrompt('won because I emphasized fintech');
    expect(system).toMatch(/durable/i);
    expect(user).toContain('won because I emphasized fintech');
    expect(user).toContain('facts');
  });
});

const profile = (over: Record<string, unknown> = {}) =>
  ({
    agencyName: 'Studio A',
    profession: 'designer',
    services: ['UI/UX'],
    skills: ['Figma'],
    tone: 'premium',
    priceMin: 5000,
    priceMax: 40000,
    portfolioLinks: [],
    caseStudies: null,
    testimonials: null,
    website: null,
    ...over,
  } as any);

const job = (over: Record<string, unknown> = {}) => ({ title: 'Acme Build', company: 'Acme', ...over } as any);

describe('analysisContext', () => {
  it('returns empty string when no analysis present or wrong type', () => {
    expect(analysisContext(job({ intelligenceJson: null }))).toBe('');
    expect(analysisContext(job({ intelligenceJson: 'oops' }))).toBe('');
  });

  it('renders every provided analysis field and caps list sizes', () => {
    const out = analysisContext(
      job({
        intelligenceJson: {
          objective: 'Launch marketplace',
          complexity: 'High',
          estimatedWeeks: 12,
          estimatedBudgetUsd: 90000,
          stack: Array.from({ length: 15 }, (_, i) => `tech${i}`),
          deliverables: Array.from({ length: 12 }, (_, i) => `del${i}`),
          risks: [{ title: 'Scope creep' }, { title: 'Timeline' }, {}],
        },
      }),
    );
    expect(out).toContain('Pre-analysis of this opportunity');
    expect(out).toContain('Client objective: Launch marketplace');
    expect(out).toContain('Complexity: High');
    expect(out).toContain('~12 weeks');
    expect(out).toContain('Estimated budget (USD): 90000');
    expect(out).toContain('tech0');
    expect(out).not.toContain('tech10'); // capped at 10
    expect(out).toContain('del0');
    expect(out).not.toContain('del8'); // capped at 8
    expect(out).toContain('Scope creep');
  });

  it('returns empty when analysis object has no meaningful fields', () => {
    expect(analysisContext(job({ intelligenceJson: {} }))).toBe('');
  });
});

describe('proofContext', () => {
  it('returns empty string when no proof points', () => {
    expect(proofContext(profile())).toBe('');
  });

  it('renders website, portfolio, case studies and testimonials (capped)', () => {
    const out = proofContext(
      profile({
        website: 'https://studioa.example',
        portfolioLinks: ['l1', 'l2', 'l3', 'l4', 'l5', 'l6'],
        caseStudies: [
          { title: 'Fintech', summary: 'cut load' },
          { title: 'NoSummary' },
          { notitle: true },
        ],
        testimonials: [{ quote: 'Great', author: 'Jane', company: 'Acme' }, { author: 'noquote' }],
      }),
    );
    expect(out).toContain('Website: https://studioa.example');
    expect(out).toContain('Portfolio: l1, l2, l3, l4, l5');
    expect(out).not.toContain('l6'); // portfolio capped at 5
    expect(out).toContain('Fintech — cut load');
    expect(out).toContain('NoSummary');
    expect(out).toContain('"Great" — Jane, Acme');
  });

  it('handles undefined portfolioLinks gracefully', () => {
    const p = profile({ website: 'https://x.example' });
    delete (p as any).portfolioLinks;
    expect(proofContext(p)).toContain('Website: https://x.example');
  });
});

describe('buildJobIntelligencePrompt', () => {
  it('includes job facts, profile and requested JSON schema keys', () => {
    const { system, user } = buildJobIntelligencePrompt(
      profile(),
      job({ projectDescription: 'desc', requirements: 'req', budget: 10000, timeline: '3mo' }),
    );
    expect(system).toContain('Studio A');
    expect(system).toContain('strategist');
    expect(system).toContain('applying to this job');
    expect(user).toContain('Title: Acme Build');
    expect(user).toContain('Company: Acme');
    expect(user).toContain('Project: desc');
    expect(user).toContain('Requirements: req');
    expect(user).toContain('Stated budget (USD): 10000');
    expect(user).toContain('Stated timeline: 3mo');
    expect(user).toContain('winProbability');
    expect(user).toContain('clarificationQuestions');
    // Should-I-Apply decision keys
    expect(user).toContain('recommendation');
    expect(user).toContain('expectedRoiUsdPerHour');
    expect(user).toContain('redFlags');
  });

  it('omits the company line when company is the em-dash placeholder', () => {
    const { user } = buildJobIntelligencePrompt(profile(), job({ company: '—' }));
    expect(user).not.toContain('Company:');
  });
});

describe('buildToneAdjustPrompt', () => {
  it('exposes the four tones', () => {
    expect([...TONES]).toEqual(['formal', 'aggressive', 'premium', 'casual']);
  });

  it.each(TONES)('embeds concrete guidance for the %s tone', (tone) => {
    const current = { summary: 'S', closing: 'C' };
    const { system, user } = buildToneAdjustPrompt(profile(), job(), tone, current);
    expect(system).toContain(`Rewrite in a ${tone} tone`);
    expect(user).toContain('Rewrite ONLY the "summary" and "closing"');
    expect(user).toContain(JSON.stringify(current));
    expect(user).toContain('summary (string), closing (string)');
  });
});

describe('buildSectionPrompt', () => {
  it.each(Object.keys(PROPOSAL_SECTIONS) as (keyof typeof PROPOSAL_SECTIONS)[])(
    'targets the %s section with its expected value type',
    (section) => {
      const current = { summary: 'S' };
      const { system, user } = buildSectionPrompt(profile(), job({ projectDescription: 'd', requirements: 'r' }), section, current);
      expect(system).toContain('Studio A');
      expect(user).toContain(`Regenerate ONLY the "${section}" section`);
      expect(user).toContain(JSON.stringify(current));
      expect(user).toContain(PROPOSAL_SECTIONS[section].type);
    },
  );
});

describe('buildProposalPrompt (budget/timeline lines)', () => {
  it('includes stated budget and timeline when present', () => {
    const { user } = buildProposalPrompt(profile(), job({ budget: 25000, timeline: '2 months' }));
    expect(user).toContain('Stated budget (USD): 25000');
    expect(user).toContain('Stated timeline: 2 months');
  });

  it('injects memory facts when provided and omits the block otherwise', () => {
    const withMem = buildProposalPrompt(profile(), job(), [{ category: 'technical', key: 'stack', value: 'Next.js' }]);
    expect(withMem.user).toContain('already know');
    expect(withMem.user).toContain('technical/stack: Next.js');
    const noMem = buildProposalPrompt(profile(), job());
    expect(noMem.user).not.toContain('already know');
  });
});
