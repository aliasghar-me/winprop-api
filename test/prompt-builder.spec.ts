import { buildProposalPrompt } from '../src/llm/prompt.builder';

const profile = (over: Record<string, unknown> = {}) =>
  ({ agencyName: 'Studio A', profession: 'designer', services: ['UI/UX'], skills: ['Figma'], tone: 'premium', priceMin: 5000, priceMax: 40000, portfolioLinks: [], caseStudies: null, testimonials: null, website: null, ...over } as any);

describe('buildProposalPrompt', () => {
  it('weaves profile + job into the prompt', () => {
    const p = buildProposalPrompt(profile(), { title: 'Acme Marketplace', company: 'Acme' } as any);
    expect(p.system).toContain('Studio A');
    expect(p.system).toContain('premium');
    expect(p.user).toContain('Acme Marketplace');
    expect(p.user).toContain('UI/UX');
  });

  it('grounds generation in the saved Job-Intelligence analysis when present (T1.1)', () => {
    const job = {
      title: 'Acme Marketplace', company: 'Acme',
      intelligenceJson: {
        objective: 'Launch a multi-vendor marketplace',
        complexity: 'High',
        estimatedWeeks: 12,
        stack: ['Next.js', 'Stripe'],
        deliverables: ['Storefront', 'Vendor portal'],
        risks: [{ title: 'Scope ambiguity' }],
      },
    } as any;
    const p = buildProposalPrompt(profile(), job);
    expect(p.user).toContain('Launch a multi-vendor marketplace');
    expect(p.user).toContain('Vendor portal');
    expect(p.user).toContain('Scope ambiguity');
  });

  it('injects real proof points (portfolio/case studies/testimonials) when present (T1.2)', () => {
    const p = buildProposalPrompt(
      profile({
        website: 'https://studioa.example',
        portfolioLinks: ['https://studioa.example/work/x'],
        caseStudies: [{ title: 'Fintech rebuild', summary: 'cut load 60%' }],
        testimonials: [{ author: 'Jane', company: 'Acme', quote: 'Outstanding work' }],
      }),
      { title: 'Acme Marketplace', company: 'Acme' } as any,
    );
    expect(p.user).toContain('Fintech rebuild');
    expect(p.user).toContain('Outstanding work');
    expect(p.user).toContain('studioa.example');
  });

  it('omits analysis/proof blocks cleanly when absent', () => {
    const p = buildProposalPrompt(profile(), { title: 'Bare Job', company: 'X' } as any);
    expect(p.user).not.toContain('Pre-analysis');
    expect(p.user).not.toContain('proof points');
  });
});
