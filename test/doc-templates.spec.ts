import {
  DOC_TEMPLATES,
  isRegistryDocType,
  buildDocPrompt,
  buildDocFieldPrompt,
  validateDoc,
} from '../src/llm/doc-templates';

const profile = (over: Record<string, unknown> = {}) =>
  ({
    agencyName: 'Studio A',
    profession: 'designer',
    services: ['UI/UX', 'Branding'],
    skills: ['Figma', 'React'],
    tone: 'premium',
    priceMin: 5000,
    priceMax: 40000,
    portfolioLinks: [],
    caseStudies: null,
    testimonials: null,
    website: null,
    ...over,
  } as any);

const job = (over: Record<string, unknown> = {}) =>
  ({ title: 'Acme Build', company: 'Acme', ...over } as any);

describe('doc-templates', () => {
  describe('DOC_TEMPLATES registry', () => {
    it('declares sow and estimate with ordered fields', () => {
      expect(DOC_TEMPLATES.sow.titlePrefix).toBe('SOW');
      expect(DOC_TEMPLATES.sow.fields.map((f) => f.key)).toEqual([
        'overview', 'deliverables', 'milestones', 'assumptions', 'timelineWeeks', 'priceUsd',
      ]);
      expect(DOC_TEMPLATES.estimate.titlePrefix).toBe('Estimate');
      expect(DOC_TEMPLATES.estimate.fields.map((f) => f.key)).toEqual([
        'summary', 'lineItems', 'timelineWeeks', 'priceUsd', 'notes',
      ]);
    });
  });

  describe('isRegistryDocType', () => {
    it('accepts registered types and rejects others', () => {
      expect(isRegistryDocType('sow')).toBe(true);
      expect(isRegistryDocType('estimate')).toBe(true);
      expect(isRegistryDocType('proposal')).toBe(false);
      expect(isRegistryDocType('nonsense')).toBe(false);
    });
  });

  describe('buildDocPrompt', () => {
    it('weaves template label, profile and job into the prompt with correct field json spec', () => {
      const { system, user } = buildDocPrompt(profile(), job({ projectDescription: 'A big build', requirements: 'Fast' }), 'sow');
      expect(system).toContain('Statement of Work');
      expect(system).toContain('Studio A');
      expect(system).toContain('premium');
      expect(system).toContain('$5000-$40000');
      expect(user).toContain('Acme Build');
      expect(user).toContain('A big build');
      expect(user).toContain('Fast');
      expect(user).toContain('UI/UX, Branding');
      // jsonType mapping: list -> array of short strings, number, money -> number in USD
      expect(user).toContain('deliverables (an array of short strings)');
      expect(user).toContain('timelineWeeks (a number)');
      expect(user).toContain('priceUsd (a number in USD)');
      expect(user).toContain('overview (a string)');
    });

    it('falls back to "professional" studio when profession missing and omits empty job lines', () => {
      const p = profile();
      delete (p as any).profession;
      const { system, user } = buildDocPrompt(p, job(), 'estimate');
      expect(system).toContain('professional studio');
      expect(user).not.toContain('Project:');
      expect(user).not.toContain('Requirements:');
      expect(user).toContain('summary (a string)');
      expect(user).toContain('lineItems (an array of short strings)');
    });
  });

  describe('buildDocFieldPrompt', () => {
    it('targets a single known field and embeds the current doc', () => {
      const current = { overview: 'old', deliverables: ['a'] };
      const { system, user } = buildDocFieldPrompt(profile(), job(), 'sow', 'deliverables', current);
      expect(system).toContain('Statement of Work');
      expect(user).toContain('Regenerate ONLY the "deliverables" field');
      expect(user).toContain(JSON.stringify(current));
      expect(user).toContain('an array of short strings');
    });

    it('throws on an unknown field key', () => {
      expect(() => buildDocFieldPrompt(profile(), job(), 'sow', 'nope', {})).toThrow('Unknown field nope for sow');
    });
  });

  describe('validateDoc', () => {
    it('accepts a fully-typed sow document', () => {
      expect(
        validateDoc('sow', {
          overview: 'x', deliverables: ['a'], milestones: ['m'], assumptions: ['s'], timelineWeeks: 8, priceUsd: 10000,
        }),
      ).toBe(true);
    });

    it('rejects non-objects and null', () => {
      expect(validateDoc('sow', null)).toBe(false);
      expect(validateDoc('sow', 'string')).toBe(false);
      expect(validateDoc('sow', 42)).toBe(false);
    });

    it('rejects when a list field is not an array', () => {
      expect(
        validateDoc('sow', {
          overview: 'x', deliverables: 'not-array', milestones: [], assumptions: [], timelineWeeks: 8, priceUsd: 1,
        }),
      ).toBe(false);
    });

    it('rejects when a number/money field is not a number', () => {
      expect(
        validateDoc('estimate', {
          summary: 'x', lineItems: [], timelineWeeks: '8', priceUsd: 1, notes: 'n',
        }),
      ).toBe(false);
      expect(
        validateDoc('estimate', {
          summary: 'x', lineItems: [], timelineWeeks: 8, priceUsd: 'free', notes: 'n',
        }),
      ).toBe(false);
    });

    it('rejects when a text field is not a string', () => {
      expect(
        validateDoc('estimate', {
          summary: 123, lineItems: [], timelineWeeks: 8, priceUsd: 1, notes: 'n',
        }),
      ).toBe(false);
    });
  });
});
