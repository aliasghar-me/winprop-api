import { buildPreviewPrompt } from '../src/llm/prompt.builder';

describe('buildPreviewPrompt', () => {
  it('includes the title and description and asks for the teaser JSON shape', () => {
    const { system, user } = buildPreviewPrompt('Marketing site rebuild', 'A 5-page site for a law firm');
    expect(system).toMatch(/proposal writer/i);
    expect(user).toContain('Marketing site rebuild');
    expect(user).toContain('A 5-page site for a law firm');
    expect(user).toContain('sections (array of exactly ONE object');
    expect(user).toContain('lockedTitles');
  });

  it('omits the description line when empty', () => {
    const { user } = buildPreviewPrompt('Logo design', '');
    expect(user).not.toContain('Project description:');
  });
});
