import { PreviewService } from '../src/public/preview.service';

// Unit-only: hand-rolled LlmService fake. Covers the honeypot reject branches
// and the happy path that delegates to llm.generatePreview.
function makeLlm() {
  return { generatePreview: jest.fn().mockResolvedValue({ summary: 'ok' }) } as any;
}

describe('PreviewService.preview', () => {
  it('delegates to llm.generatePreview when the honeypot is empty', async () => {
    const llm = makeLlm();
    const svc = new PreviewService(llm);
    const out = await svc.preview({ title: 'T', description: 'D' } as any);
    expect(llm.generatePreview).toHaveBeenCalledWith('T', 'D');
    expect(out).toEqual({ summary: 'ok' });
  });

  it('passes through when website is undefined', async () => {
    const llm = makeLlm();
    const svc = new PreviewService(llm);
    await svc.preview({ title: 'T', description: 'D' } as any);
    expect(llm.generatePreview).toHaveBeenCalled();
  });

  it('rejects a filled honeypot as a generic bad request', async () => {
    const llm = makeLlm();
    const svc = new PreviewService(llm);
    await expect(svc.preview({ title: 'T', description: 'D', website: 'http://bot.example' } as any)).rejects.toMatchObject({
      code: 'VALIDATION',
      translationKey: 'errors.badRequest',
    });
    expect(llm.generatePreview).not.toHaveBeenCalled();
  });

  it('treats a whitespace-only honeypot as empty (trim branch)', async () => {
    const llm = makeLlm();
    const svc = new PreviewService(llm);
    await svc.preview({ title: 'T', description: 'D', website: '   ' } as any);
    expect(llm.generatePreview).toHaveBeenCalled();
  });
});
