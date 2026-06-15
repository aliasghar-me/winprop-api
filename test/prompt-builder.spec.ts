import { buildProposalPrompt } from '../src/llm/prompt.builder';

describe('buildProposalPrompt', () => {
  it('weaves profile + job into the prompt', () => {
    const p = buildProposalPrompt(
      { agencyName: 'Studio A', profession: 'designer', services: ['UI/UX'], skills: ['Figma'], tone: 'premium', priceMin: 5000, priceMax: 40000 } as any,
      { title: 'Acme Marketplace', company: 'Acme' } as any,
    );
    expect(p.system).toContain('Studio A');
    expect(p.system).toContain('premium');
    expect(p.user).toContain('Acme Marketplace');
    expect(p.user).toContain('UI/UX');
  });
});
