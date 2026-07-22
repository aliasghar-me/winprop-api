import { ExportController } from '../src/export/export.controller';

// Unit-only: instantiate ExportController with a mocked ExportService.
// The controller sets PDF headers and streams the buffer via res.send().

function makeRes() {
  return {
    headers: {} as Record<string, string>,
    sent: undefined as any,
    set(h: Record<string, string>) { Object.assign(this.headers, h); return this; },
    send(body: any) { this.sent = body; return this; },
  };
}

const user = { orgId: 'org1', userId: 'u1' } as any;

describe('ExportController', () => {
  it('renders the PDF, sets Content-Type/Disposition headers and sends the buffer', async () => {
    const pdf = Buffer.from('%PDF-1.4 fake');
    const svc = { renderProposalPdf: jest.fn().mockResolvedValue(pdf) };
    const ctrl = new ExportController(svc as any);
    const res = makeRes();

    await ctrl.pdf(user, 'job1', 'doc1', res as any);

    expect(svc.renderProposalPdf).toHaveBeenCalledWith('org1', 'job1', 'doc1');
    expect(res.headers['Content-Type']).toBe('application/pdf');
    expect(res.headers['Content-Disposition']).toBe('attachment; filename="proposal-doc1.pdf"');
    expect(res.sent).toBe(pdf);
  });
});
