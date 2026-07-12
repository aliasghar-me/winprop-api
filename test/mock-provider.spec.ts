import { MockProvider } from '../src/llm/providers/mock.provider';
import type { LlmMessages } from '../src/llm/llm-provider.interface';

// Unit-only: MockProvider is a pure, deterministic string builder. Drive generate()
// with the exact marker substrings each branch keys off (see mock.provider.ts) and
// assert the returned JSON shape + reported usage per path.

describe('MockProvider', () => {
  const provider = new MockProvider();
  const msg = (user: string): LlmMessages => ({ system: 'sys', user });
  const gen = (user: string) => provider.generate('mock-model', 'key', msg(user));
  const parse = async (user: string) => JSON.parse((await gen(user)).text);

  it('exposes the mock vendor', () => {
    expect(provider.vendor).toBe('mock');
  });

  it('reports fixed usage on every call', async () => {
    const r = await gen('anything');
    expect(r.promptTokens).toBe(600);
    expect(r.completionTokens).toBe(300);
  });

  it('returns a job-intelligence analysis when asked for the objective keys', async () => {
    const json = await parse('Return JSON with keys: objective ... for job "Rebuild storefront".');
    expect(json.objective).toContain('Rebuild storefront');
    expect(json.domain).toBe('Web / SaaS');
    expect(Array.isArray(json.stack)).toBe(true);
    expect(Array.isArray(json.risks)).toBe(true);
    expect(json.winProbability.score).toBe(72);
    expect(json.clarificationQuestions.length).toBeGreaterThan(0);
  });

  describe('per-section regenerate path', () => {
    it('summary -> string mentioning client + job', async () => {
      const json = await parse('Regenerate ONLY the "summary" section for job "New app" (client: Acme Ltd).');
      expect(typeof json.value).toBe('string');
      expect(json.value).toContain('Acme Ltd');
      expect(json.value).toContain('New app');
    });

    it('scope -> array of strings', async () => {
      const json = await parse('Regenerate ONLY the "scope" section.');
      expect(Array.isArray(json.value)).toBe(true);
      expect(json.value.length).toBeGreaterThan(0);
    });

    it('timeline -> number', async () => {
      const json = await parse('Regenerate ONLY the "timeline" section.');
      expect(json.value).toBe(8);
    });

    it('pricing -> number', async () => {
      const json = await parse('Regenerate ONLY the "pricing" section.');
      expect(json.value).toBe(32000);
    });

    it('closing -> string mentioning client', async () => {
      const json = await parse('Regenerate ONLY the "closing" section (client: Beta Co).');
      expect(typeof json.value).toBe('string');
      expect(json.value).toContain('Beta Co');
    });

    it('unknown section -> default "Updated X." string', async () => {
      const json = await parse('Regenerate ONLY the "whyUs" section.');
      expect(json.value).toBe('Updated whyUs.');
    });
  });

  describe('landing-funnel preview path', () => {
    it('uses the project title when present', async () => {
      const json = await parse(
        'sections (array of exactly ONE object)\nProject title: Cool Marketplace',
      );
      expect(json.sections).toHaveLength(1);
      expect(json.sections[0].heading).toBe('Overview');
      expect(json.sections[0].body).toContain('Cool Marketplace');
      expect(json.lockedTitles).toEqual(
        expect.arrayContaining(['Scope of work', 'Timeline', 'Investment', 'Why us', 'Next steps']),
      );
    });

    it('falls back to "your project" when no project title is given', async () => {
      const json = await parse('sections (array of exactly ONE object)');
      expect(json.sections[0].body).toContain('your project');
    });
  });

  describe('full-proposal fallthrough path', () => {
    it('extracts job + client from job "..." (client: ...) form', async () => {
      const json = await parse('Write a proposal for job "Marketing site" (client: Northwind).');
      expect(json.summary).toContain('Northwind');
      expect(json.summary).toContain('Marketing site');
      expect(Array.isArray(json.scope)).toBe(true);
      expect(json.timelineWeeks).toBe(8);
      expect(json.priceUsd).toBe(32000);
      expect(json.closing).toContain('Northwind');
    });

    it('falls back to the Title: form for the job and default client', async () => {
      const json = await parse('Title: Portfolio revamp\nNo client marker here.');
      expect(json.summary).toContain('Portfolio revamp');
      expect(json.summary).toContain('the client'); // client default
    });

    it('falls back to generic defaults when neither job nor client markers exist', async () => {
      const json = await parse('Please write something nice.');
      expect(json.summary).toContain('the client');
      expect(json.summary).toContain('the project');
    });
  });
});
