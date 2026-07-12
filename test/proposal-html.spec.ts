import { buildProposalHtml, buildDocHtml } from '../src/export/proposal-html';
import { DOC_TEMPLATES } from '../src/llm/doc-templates';

describe('buildProposalHtml', () => {
  const doc = (over = {}) =>
    ({
      title: 'Acme Build',
      contentJson: { summary: 'Sum', scope: ['One', 'Two'], timelineWeeks: 8, priceUsd: 32000, closing: 'Thanks' },
      ...over,
    } as any);

  it('renders branded, self-contained HTML with the proposal content + logo', () => {
    const html = buildProposalHtml(doc(), {
      agencyName: 'Pixel Studio',
      brandColor: '#ff0066',
      brandShort: 'PS',
      logoUrl: 'https://cdn/logo.png',
    } as any);
    expect(html).toContain('Pixel Studio');
    expect(html).toContain('#ff0066');
    expect(html).toContain('Acme Build');
    expect(html).toContain('$32,000');
    expect(html).toContain('<li>One</li>');
    expect(html).toContain('<li>Two</li>');
    expect(html).toContain('8 weeks');
    expect(html).toContain('Thanks');
    // logoUrl present -> <img> header (not the .mark fallback)
    expect(html).toContain('<img src="https://cdn/logo.png"');
    expect(html).not.toContain('class="mark"');
    expect(html).not.toContain('<script'); // self-contained, no JS
  });

  it('falls back to brand defaults + .mark when profile fields are absent (null profile)', () => {
    const html = buildProposalHtml(doc(), null);
    expect(html).toContain('#6366F1'); // brandColor fallback
    expect(html).toContain('WinProp'); // agencyName fallback
    expect(html).toContain('<div class="mark">WP</div>'); // brandShort fallback
    expect(html).not.toContain('<img'); // no logoUrl -> no img
  });

  it('uses brandShort in the .mark when logoUrl is absent but brandShort is set', () => {
    const html = buildProposalHtml(doc(), {
      agencyName: 'Studio',
      brandColor: null,
      brandShort: 'ST',
      logoUrl: null,
    } as any);
    expect(html).toContain('<div class="mark">ST</div>');
    expect(html).toContain('#6366F1'); // null brandColor -> default
  });

  it('omits every optional section when contentJson is empty', () => {
    const html = buildProposalHtml(doc({ contentJson: {} }), { agencyName: 'S', brandShort: 'S' } as any);
    expect(html).not.toContain('<h2>Summary</h2>');
    expect(html).not.toContain('<h2>Scope</h2>');
    expect(html).not.toContain('<h2>Timeline</h2>');
    expect(html).not.toContain('<h2>Investment</h2>');
    expect(html).not.toContain('<h2>Next steps</h2>');
    // still a valid shell
    expect(html).toContain('Powered by WinProp');
  });

  it('treats missing/null contentJson as empty (?? {} branch)', () => {
    const html = buildProposalHtml(doc({ contentJson: null }), null);
    expect(html).toContain('<h1>Acme Build</h1>');
    expect(html).not.toContain('<h2>Summary</h2>');
  });

  it('omits price when priceUsd is not a number, and timeline when not a number', () => {
    const html = buildProposalHtml(
      doc({ contentJson: { summary: 'S', priceUsd: 'lots', timelineWeeks: 'soon' } }),
      null,
    );
    expect(html).toContain('<h2>Summary</h2>');
    expect(html).not.toContain('<h2>Investment</h2>');
    expect(html).not.toContain('<h2>Timeline</h2>');
  });

  it('escapes content to prevent HTML injection (all special chars)', () => {
    const html = buildProposalHtml(
      buildDoc({ contentJson: { summary: `<img src=x onerror=alert(1)> & "q" 'a'` } }),
      { agencyName: 'A & Co', brandColor: '#000', brandShort: 'S' } as any,
    );
    expect(html).not.toContain('<img src=x onerror');
    expect(html).toContain('&lt;img');
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;');
    expect(html).toContain('&#39;');
    expect(html).toContain('A &amp; Co'); // agencyName escaped too
  });

  function buildDoc(over = {}) {
    return { title: 'Acme Build', contentJson: {}, ...over } as any;
  }
});

describe('buildDocHtml (registry doc types)', () => {
  const doc = (contentJson: any) => ({ title: 'SOW: Acme', contentJson } as any);

  it('renders every field type when fully populated', () => {
    const html = buildDocHtml(
      doc({
        overview: 'A clear overview',
        deliverables: ['Design', 'Build'],
        milestones: ['M1'],
        assumptions: ['Access provided'],
        timelineWeeks: 10,
        priceUsd: 50000,
      }),
      { agencyName: 'Studio', brandShort: 'S' } as any,
      DOC_TEMPLATES.sow.fields,
    );
    expect(html).toContain('<h2>Overview</h2>'); // text
    expect(html).toContain('A clear overview');
    expect(html).toContain('<h2>Deliverables</h2>'); // list
    expect(html).toContain('<li>Design</li>');
    expect(html).toContain('<h2>Timeline (weeks)</h2>'); // number
    expect(html).toContain('<p>10</p>');
    expect(html).toContain('<h2>Price</h2>'); // money
    expect(html).toContain('$50,000');
  });

  it('omits fields with empty/wrong-typed values (each type falsy branch)', () => {
    const html = buildDocHtml(
      doc({
        overview: '', // text falsy
        deliverables: [], // list empty -> items '' -> omit
        milestones: 'not-an-array', // list not-array -> omit
        assumptions: undefined,
        timelineWeeks: 'ten', // number not-a-number -> omit
        priceUsd: 'free', // money not-a-number -> omit
      }),
      null,
      DOC_TEMPLATES.sow.fields,
    );
    expect(html).not.toContain('<h2>Overview</h2>');
    expect(html).not.toContain('<h2>Deliverables</h2>');
    expect(html).not.toContain('<h2>Milestones</h2>');
    expect(html).not.toContain('<h2>Timeline (weeks)</h2>');
    expect(html).not.toContain('<h2>Price</h2>');
    // shell still rendered
    expect(html).toContain('<h1>SOW: Acme</h1>');
  });

  it('handles null contentJson (?? {} branch) — renders no sections', () => {
    const html = buildDocHtml({ title: 'Estimate: X', contentJson: null } as any, null, DOC_TEMPLATES.estimate.fields);
    expect(html).toContain('<h1>Estimate: X</h1>');
    expect(html).not.toContain('<h2>Summary</h2>');
  });

  it('escapes list items and number/text values', () => {
    const html = buildDocHtml(
      doc({ overview: '<b>bold</b>', deliverables: ['<script>x</script>'] }),
      null,
      DOC_TEMPLATES.sow.fields,
    );
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>x</script>');
  });
});
