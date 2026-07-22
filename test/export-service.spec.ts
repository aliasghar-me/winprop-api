// Unit-only: mock the `playwright` module so we exercise every branch of
// ExportService.renderProposalPdf without launching a real browser. Covers the
// success path, the launch-options channel branch, the registry-doc branch, the
// not-found branches, and the pdf/page error → catch → 502 path (l.35-36), while
// still calling browser.close() in the finally.

const launch = jest.fn();
jest.mock('playwright', () => ({ chromium: { launch: (...a: any[]) => launch(...a) } }));

import { ExportService } from '../src/export/export.service';

function makeBrowser(over: { pdf?: any; setContent?: any; newPage?: any } = {}) {
  const close = jest.fn().mockResolvedValue(undefined);
  const page = {
    setContent: over.setContent ?? jest.fn().mockResolvedValue(undefined),
    pdf: over.pdf ?? jest.fn().mockResolvedValue(Buffer.from('%PDF-fake')),
  };
  const browser = {
    newPage: over.newPage ?? jest.fn().mockResolvedValue(page),
    close,
  };
  return { browser, page, close };
}

function makeSvc(opts: {
  doc?: any;
  profile?: any;
} = {}) {
  const doc = opts.doc === undefined ? { id: 'd1', type: 'proposal', title: 'T', contentJson: { summary: 's' } } : opts.doc;
  const prisma: any = {
    document: { findFirst: jest.fn().mockResolvedValue(doc) },
    profile: { findUnique: jest.fn().mockResolvedValue(opts.profile ?? { orgId: 'o1', agencyName: 'Studio' }) },
  };
  const jobs: any = { getOwned: jest.fn().mockResolvedValue({ id: 'j1', title: 'Job' }) };
  return { svc: new ExportService(prisma, jobs), prisma, jobs };
}

describe('ExportService.renderProposalPdf (unit)', () => {
  const prevChannel = process.env.PLAYWRIGHT_CHROMIUM_CHANNEL;
  beforeEach(() => {
    launch.mockReset();
    delete process.env.PLAYWRIGHT_CHROMIUM_CHANNEL;
  });
  afterAll(() => {
    if (prevChannel === undefined) delete process.env.PLAYWRIGHT_CHROMIUM_CHANNEL;
    else process.env.PLAYWRIGHT_CHROMIUM_CHANNEL = prevChannel;
  });

  it('renders a proposal PDF (success path) and launches with empty opts by default', async () => {
    const { browser, page, close } = makeBrowser();
    launch.mockResolvedValue(browser);
    const { svc } = makeSvc();

    const buf = await svc.renderProposalPdf('o1', 'j1', 'd1');
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(launch).toHaveBeenCalledWith({}); // no channel env → empty options
    expect(page.setContent).toHaveBeenCalled();
    expect(page.pdf).toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1); // finally
  });

  it('passes channel through launch options when PLAYWRIGHT_CHROMIUM_CHANNEL is set', async () => {
    process.env.PLAYWRIGHT_CHROMIUM_CHANNEL = 'chrome';
    const { browser } = makeBrowser();
    launch.mockResolvedValue(browser);
    const { svc } = makeSvc();

    await svc.renderProposalPdf('o1', 'j1', 'd1');
    expect(launch).toHaveBeenCalledWith({ channel: 'chrome' });
  });

  it('uses the registry doc template branch for a registry doc type (sow)', async () => {
    const { browser } = makeBrowser();
    launch.mockResolvedValue(browser);
    const { svc } = makeSvc({ doc: { id: 'd1', type: 'sow', title: 'SOW', contentJson: {} } });

    const buf = await svc.renderProposalPdf('o1', 'j1', 'd1');
    expect(Buffer.isBuffer(buf)).toBe(true);
  });

  it('renders even when the profile is null (buildProposalHtml tolerates null)', async () => {
    const { browser } = makeBrowser();
    launch.mockResolvedValue(browser);
    const { svc } = makeSvc({ profile: null });
    const buf = await svc.renderProposalPdf('o1', 'j1', 'd1');
    expect(Buffer.isBuffer(buf)).toBe(true);
  });

  it('throws NOT_FOUND when the document does not exist (and never launches a browser)', async () => {
    const { svc } = makeSvc({ doc: null });
    await expect(svc.renderProposalPdf('o1', 'j1', 'missing')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      translationKey: 'errors.documentNotFound',
    });
    expect(launch).not.toHaveBeenCalled();
  });

  it('maps a pdf() failure to EXPORT_FAILED (502) and still closes the browser', async () => {
    const { browser, close } = makeBrowser({ pdf: jest.fn().mockRejectedValue(new Error('render boom')) });
    launch.mockResolvedValue(browser);
    const { svc } = makeSvc();
    const errSpy = jest.spyOn((svc as any).logger, 'error').mockImplementation(() => undefined);

    await expect(svc.renderProposalPdf('o1', 'j1', 'd1')).rejects.toMatchObject({
      code: 'EXPORT_FAILED',
      translationKey: 'errors.exportFailed',
    });
    expect(errSpy).toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1); // finally ran despite the throw
  });

  it('handles a non-Error thrown value in the catch (String() fallback)', async () => {
    const { browser, close } = makeBrowser({ setContent: jest.fn().mockRejectedValue('plain-string-failure') });
    launch.mockResolvedValue(browser);
    const { svc } = makeSvc();
    const errSpy = jest.spyOn((svc as any).logger, 'error').mockImplementation(() => undefined);

    await expect(svc.renderProposalPdf('o1', 'j1', 'd1')).rejects.toMatchObject({ code: 'EXPORT_FAILED' });
    expect(errSpy.mock.calls[0][0]).toContain('plain-string-failure');
    expect(close).toHaveBeenCalledTimes(1);
  });
});
