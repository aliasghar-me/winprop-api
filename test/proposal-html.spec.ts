import { buildProposalHtml } from '../src/export/proposal-html';

describe('buildProposalHtml', () => {
  const doc = (over = {}) => ({ title: 'Acme Build', contentJson: { summary: 'Sum', scope: ['One', 'Two'], timelineWeeks: 8, priceUsd: 32000, closing: 'Thanks' }, ...over } as any);

  it('renders branded, self-contained HTML with the proposal content', () => {
    const html = buildProposalHtml(doc(), { agencyName: 'Pixel Studio', brandColor: '#ff0066', brandShort: 'PS', logoUrl: null } as any);
    expect(html).toContain('Pixel Studio');
    expect(html).toContain('#ff0066');
    expect(html).toContain('Acme Build');
    expect(html).toContain('$32,000');
    expect(html).toContain('<li>One</li>');
    expect(html).not.toContain('<script'); // self-contained, no JS
  });

  it('escapes content to prevent HTML injection', () => {
    const html = buildProposalHtml(doc({ contentJson: { summary: '<img src=x onerror=alert(1)>' } }) , { agencyName: 'S', brandColor: '#000', brandShort: 'S', logoUrl: null } as any);
    expect(html).not.toContain('<img src=x onerror');
    expect(html).toContain('&lt;img');
  });
});
