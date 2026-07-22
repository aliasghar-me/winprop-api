import { DocumentsService } from '../src/documents/documents.service';
import { AppException } from '../src/common/errors/app-exception';

// Hand-rolled fakes for DocumentsService's constructor deps (PrismaService,
// LlmService, JobsService). No Nest DI, no Postgres — same house style as
// llm-service.spec.ts / generate-preview.spec.ts.

const GEN = {
  provider: 'anthropic',
  model: 'claude-opus-4-8',
  promptTokens: 100,
  completionTokens: 50,
  costUsd: 0.01,
  priceMapVersion: 'v1',
};

const PROFILE = {
  orgId: 'org1',
  agencyName: 'A',
  tone: 'premium',
  services: ['web'],
  skills: ['design'],
  priceMin: 100,
  priceMax: 1000,
};

const ORG = { id: 'org1', profession: 'design' };
const JOB = { id: 'job1', title: 'Landing page', company: 'ACME' };

function makeDeps(overrides: {
  prisma?: any;
  llm?: any;
  jobs?: any;
  memory?: any;
} = {}) {
  const txObj = {
    document: { create: jest.fn().mockResolvedValue({ id: 'doc-new' }), update: jest.fn().mockResolvedValue({ id: 'doc1', updated: true }) },
    documentVersion: { create: jest.fn().mockResolvedValue({ id: 'ver1' }) },
    generationLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma: any = {
    profile: { findUnique: jest.fn().mockResolvedValue(PROFILE) },
    org: { findUnique: jest.fn().mockResolvedValue(ORG) },
    document: {
      findFirst: jest.fn().mockResolvedValue({ id: 'doc1', jobId: 'job1', type: 'proposal', title: 'T', version: 1, contentJson: { summary: 'hi' }, shareToken: null }),
      create: jest.fn().mockResolvedValue({ id: 'dup1' }),
      update: jest.fn().mockResolvedValue({ id: 'doc1', updated: true }),
    },
    documentVersion: { findMany: jest.fn().mockResolvedValue([{ version: 1 }]) },
    generationLog: { create: jest.fn().mockResolvedValue({}) },
    quotaPeriod: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    $transaction: jest.fn((arg: any) => (typeof arg === 'function' ? arg(txObj) : Promise.all(arg))),
    __tx: txObj,
    ...overrides.prisma,
  };
  const llm: any = {
    generateProposal: jest.fn().mockResolvedValue({ ...GEN, text: JSON.stringify({ summary: 'A good summary' }) }),
    generateDoc: jest.fn().mockResolvedValue({ ...GEN, text: JSON.stringify({ overview: 'o', deliverables: ['d'], milestones: ['m'], assumptions: ['a'], timelineWeeks: 4, priceUsd: 500 }) }),
    regenerateSection: jest.fn().mockResolvedValue({ ...GEN, key: 'summary', value: 'new value' }),
    regenerateDocField: jest.fn().mockResolvedValue({ ...GEN, key: 'overview', value: 'new field' }),
    adjustToneProse: jest.fn().mockResolvedValue({ ...GEN, summary: 'toned summary', closing: 'toned closing' }),
    ...overrides.llm,
  };
  const jobs: any = {
    getOwned: jest.fn().mockResolvedValue(JOB),
    ...overrides.jobs,
  };
  const memory: any = {
    forPrompt: jest.fn().mockResolvedValue([]),
    ...overrides.memory,
  };
  const svc = new DocumentsService(prisma, llm, jobs, memory);
  return { svc, prisma, llm, jobs, memory, txObj };
}

const RES = { orgId: 'org1', periodStart: new Date('2026-01-01') };

describe('DocumentsService.generate dispatch', () => {
  it('routes proposal type to generateProposal and creates a proposal doc', async () => {
    const { svc, prisma, llm } = makeDeps();
    const doc = await svc.generate('org1', 'job1', 'proposal', RES);
    expect(llm.generateProposal).toHaveBeenCalled();
    expect(llm.generateDoc).not.toHaveBeenCalled();
    expect(prisma.__tx.document.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'proposal', status: 'ready', version: 1 }) }),
    );
    expect(doc).toEqual({ id: 'doc-new' });
  });

  it('loads org memory and passes it to generateProposal', async () => {
    const facts = [{ category: 'technical', key: 'stack', value: 'Next.js' }];
    const { svc, llm, memory } = makeDeps({ memory: { forPrompt: jest.fn().mockResolvedValue(facts) } });
    await svc.generateProposal('org1', 'job1', RES);
    expect(memory.forPrompt).toHaveBeenCalledWith('org1');
    expect(llm.generateProposal).toHaveBeenCalledWith(expect.anything(), JOB, facts);
  });

  it('still generates when memory lookup fails (best-effort)', async () => {
    const { svc, llm } = makeDeps({ memory: { forPrompt: jest.fn().mockRejectedValue(new Error('mem down')) } });
    const doc = await svc.generateProposal('org1', 'job1', RES);
    expect(llm.generateProposal).toHaveBeenCalledWith(expect.anything(), JOB, []);
    expect(doc).toEqual({ id: 'doc-new' });
  });

  it('routes registry type (sow) to generateRegistryDoc', async () => {
    const { svc, llm, prisma } = makeDeps();
    await svc.generate('org1', 'job1', 'sow', RES);
    expect(llm.generateDoc).toHaveBeenCalled();
    expect(prisma.__tx.document.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'sow' }) }),
    );
  });

  it('routes registry type (estimate)', async () => {
    const { svc, llm } = makeDeps({
      llm: { generateDoc: jest.fn().mockResolvedValue({ ...GEN, text: JSON.stringify({ summary: 's', lineItems: ['x'], timelineWeeks: 2, priceUsd: 300, notes: 'n' }) }) },
    });
    const doc = await svc.generate('org1', 'job1', 'estimate');
    expect(llm.generateDoc).toHaveBeenCalled();
    expect(doc).toEqual({ id: 'doc-new' });
  });
});

describe('DocumentsService.generateProposal error/branch paths', () => {
  it('throws NOT_FOUND when profile missing and releases quota', async () => {
    const { svc, prisma } = makeDeps({ prisma: { profile: { findUnique: jest.fn().mockResolvedValue(null) } } });
    await expect(svc.generateProposal('org1', 'job1', RES)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(prisma.quotaPeriod.updateMany).toHaveBeenCalled();
  });

  it('throws llmUnreadable on non-JSON LLM output', async () => {
    const { svc } = makeDeps({ llm: { generateProposal: jest.fn().mockResolvedValue({ ...GEN, text: 'not json' }) } });
    await expect(svc.generateProposal('org1', 'job1')).rejects.toMatchObject({ code: 'LLM_PROVIDER_ERROR', translationKey: 'errors.llmUnreadable' });
  });

  it('throws llmIncomplete when summary missing/empty', async () => {
    const { svc } = makeDeps({ llm: { generateProposal: jest.fn().mockResolvedValue({ ...GEN, text: JSON.stringify({ summary: '  ' }) }) } });
    await expect(svc.generateProposal('org1', 'job1')).rejects.toMatchObject({ translationKey: 'errors.llmIncomplete' });
  });

  it('throws llmIncomplete when content is not an object', async () => {
    const { svc } = makeDeps({ llm: { generateProposal: jest.fn().mockResolvedValue({ ...GEN, text: JSON.stringify('astring') }) } });
    await expect(svc.generateProposal('org1', 'job1')).rejects.toMatchObject({ translationKey: 'errors.llmIncomplete' });
  });

  it('releases quota when the LLM call itself throws', async () => {
    const { svc, prisma } = makeDeps({ llm: { generateProposal: jest.fn().mockRejectedValue(new Error('boom')) } });
    await expect(svc.generateProposal('org1', 'job1', RES)).rejects.toThrow('boom');
    expect(prisma.quotaPeriod.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orgId: 'org1' }), data: { used: { decrement: 1 } } }),
    );
  });

  it('does NOT release quota when no reservation was passed', async () => {
    const { svc, prisma } = makeDeps({ llm: { generateProposal: jest.fn().mockRejectedValue(new Error('boom')) } });
    await expect(svc.generateProposal('org1', 'job1')).rejects.toThrow('boom');
    expect(prisma.quotaPeriod.updateMany).not.toHaveBeenCalled();
  });

  it('swallows a release failure and still throws the original error', async () => {
    const { svc } = makeDeps({
      prisma: { quotaPeriod: { updateMany: jest.fn().mockRejectedValue(new Error('release fail')) } },
      llm: { generateProposal: jest.fn().mockRejectedValue(new AppException(502, 'LLM_PROVIDER_ERROR', 'errors.x')) },
    });
    await expect(svc.generateProposal('org1', 'job1', RES)).rejects.toMatchObject({ code: 'LLM_PROVIDER_ERROR' });
  });
});

describe('DocumentsService.generateRegistryDoc error/branch paths', () => {
  it('throws NOT_FOUND when profile missing', async () => {
    const { svc } = makeDeps({ prisma: { profile: { findUnique: jest.fn().mockResolvedValue(null) } } });
    await expect(svc.generate('org1', 'job1', 'sow', RES)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('throws llmUnreadable on non-JSON', async () => {
    const { svc } = makeDeps({ llm: { generateDoc: jest.fn().mockResolvedValue({ ...GEN, text: 'nope' }) } });
    await expect(svc.generate('org1', 'job1', 'sow')).rejects.toMatchObject({ translationKey: 'errors.llmUnreadable' });
  });

  it('throws llmIncomplete when the doc fails registry validation', async () => {
    const { svc } = makeDeps({ llm: { generateDoc: jest.fn().mockResolvedValue({ ...GEN, text: JSON.stringify({ overview: 'o' }) }) } });
    await expect(svc.generate('org1', 'job1', 'sow')).rejects.toMatchObject({ translationKey: 'errors.llmIncomplete' });
  });
});

describe('DocumentsService.getOne', () => {
  it('returns the document when found', async () => {
    const { svc, jobs } = makeDeps();
    const doc = await svc.getOne('org1', 'job1', 'doc1');
    expect(jobs.getOwned).toHaveBeenCalledWith('org1', 'job1');
    expect(doc).toMatchObject({ id: 'doc1' });
  });

  it('throws NOT_FOUND when the document is missing', async () => {
    const { svc } = makeDeps({ prisma: { document: { findFirst: jest.fn().mockResolvedValue(null) } } });
    await expect(svc.getOne('org1', 'job1', 'x')).rejects.toMatchObject({ translationKey: 'errors.documentNotFound' });
  });
});

describe('DocumentsService.update', () => {
  it('updates title/status without versioning when content unchanged', async () => {
    const { svc, prisma } = makeDeps();
    await svc.update('org1', 'job1', 'doc1', { title: 'New', status: 'ready' });
    expect(prisma.document.update).toHaveBeenCalledWith({ where: { id: 'doc1' }, data: { title: 'New', status: 'ready' } });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('returns the doc unchanged when nothing to update', async () => {
    const { svc, prisma } = makeDeps();
    const doc = await svc.update('org1', 'job1', 'doc1', {});
    expect(doc).toMatchObject({ id: 'doc1' });
    expect(prisma.document.update).not.toHaveBeenCalled();
  });

  it('snapshots + bumps version when content changes', async () => {
    const { svc, prisma, txObj } = makeDeps();
    await svc.update('org1', 'job1', 'doc1', { contentJson: { summary: 'changed' }, title: 'T2', status: 'draft' });
    expect(txObj.documentVersion.create).toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('snapshots when content changes without title/status', async () => {
    const { svc, txObj } = makeDeps();
    await svc.update('org1', 'job1', 'doc1', { contentJson: { summary: 'changed2' } });
    expect(txObj.document.update).toHaveBeenCalled();
  });
});

describe('DocumentsService.listVersions', () => {
  it('lists versions for the document', async () => {
    const { svc, prisma } = makeDeps();
    const v = await svc.listVersions('org1', 'job1', 'doc1');
    expect(prisma.documentVersion.findMany).toHaveBeenCalledWith({ where: { documentId: 'doc1' }, orderBy: { version: 'desc' } });
    expect(v).toEqual([{ version: 1 }]);
  });
});

describe('DocumentsService.duplicate', () => {
  it('duplicates into the same job by default', async () => {
    const { svc, prisma, jobs } = makeDeps();
    await svc.duplicate('org1', 'job1', 'doc1');
    expect(prisma.document.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ jobId: 'job1', status: 'draft', version: 1 }) }),
    );
    expect(jobs.getOwned).toHaveBeenCalledTimes(1); // only the source getOne scope check
  });

  it('tenant-scopes a different target job before copying', async () => {
    const { svc, prisma, jobs } = makeDeps();
    await svc.duplicate('org1', 'job1', 'doc1', 'job2');
    expect(jobs.getOwned).toHaveBeenCalledWith('org1', 'job2');
    expect(prisma.document.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ jobId: 'job2' }) }),
    );
  });

  it('does not re-scope when targetJobId equals jobId', async () => {
    const { svc, jobs } = makeDeps();
    await svc.duplicate('org1', 'job1', 'doc1', 'job1');
    expect(jobs.getOwned).toHaveBeenCalledTimes(1);
  });
});

describe('DocumentsService.share / unshare', () => {
  it('creates a new share token when none exists', async () => {
    const { svc, prisma } = makeDeps();
    const r = await svc.share('org1', 'job1', 'doc1');
    expect(prisma.document.update).toHaveBeenCalled();
    expect(r.token).toBeDefined();
    expect(r.url).toContain(r.token);
  });

  it('returns the existing token without writing', async () => {
    const { svc, prisma } = makeDeps({
      prisma: { document: { findFirst: jest.fn().mockResolvedValue({ id: 'doc1', jobId: 'job1', shareToken: 'existing' }), update: jest.fn() } },
    });
    const r = await svc.share('org1', 'job1', 'doc1');
    expect(r.token).toBe('existing');
    expect(prisma.document.update).not.toHaveBeenCalled();
  });

  it('revokes an existing share token', async () => {
    const { svc, prisma } = makeDeps({
      prisma: { document: { findFirst: jest.fn().mockResolvedValue({ id: 'doc1', jobId: 'job1', shareToken: 'tok' }), update: jest.fn().mockResolvedValue({}) } },
    });
    const r = await svc.unshare('org1', 'job1', 'doc1');
    expect(prisma.document.update).toHaveBeenCalledWith({ where: { id: 'doc1' }, data: { shareToken: null } });
    expect(r).toEqual({ ok: true });
  });

  it('unshare is a no-op when there is no token', async () => {
    const { svc, prisma } = makeDeps();
    const r = await svc.unshare('org1', 'job1', 'doc1');
    expect(prisma.document.update).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: true });
  });
});

describe('DocumentsService.regenerateSection', () => {
  it('uses the proposal section prompt for a proposal doc', async () => {
    const { svc, llm, prisma } = makeDeps();
    const r = await svc.regenerateSection('org1', 'job1', 'doc1', 'summary', RES);
    expect(llm.regenerateSection).toHaveBeenCalled();
    expect(llm.regenerateDocField).not.toHaveBeenCalled();
    expect(prisma.generationLog.create).toHaveBeenCalled();
    expect(r).toEqual({ section: 'summary', key: 'summary', value: 'new value' });
  });

  it('uses the registry field prompt for a sow doc', async () => {
    const { svc, llm } = makeDeps({
      prisma: { document: { findFirst: jest.fn().mockResolvedValue({ id: 'doc1', jobId: 'job1', type: 'sow', version: 1, contentJson: {} }) } },
    });
    const r = await svc.regenerateSection('org1', 'job1', 'doc1', 'overview');
    expect(llm.regenerateDocField).toHaveBeenCalled();
    expect(llm.regenerateSection).not.toHaveBeenCalled();
    expect(r.key).toBe('overview');
  });

  it('handles a doc with null contentJson', async () => {
    const { svc, llm } = makeDeps({
      prisma: { document: { findFirst: jest.fn().mockResolvedValue({ id: 'doc1', jobId: 'job1', type: 'proposal', version: 1, contentJson: null }) } },
    });
    await svc.regenerateSection('org1', 'job1', 'doc1', 'summary');
    expect(llm.regenerateSection).toHaveBeenCalled();
  });

  it('releases quota and rethrows on failure', async () => {
    const { svc, prisma } = makeDeps({ llm: { regenerateSection: jest.fn().mockRejectedValue(new Error('llm down')) } });
    await expect(svc.regenerateSection('org1', 'job1', 'doc1', 'summary', RES)).rejects.toThrow('llm down');
    expect(prisma.quotaPeriod.updateMany).toHaveBeenCalled();
  });

  it('throws NOT_FOUND when profile missing', async () => {
    const { svc } = makeDeps({ prisma: { profile: { findUnique: jest.fn().mockResolvedValue(null) } } });
    await expect(svc.regenerateSection('org1', 'job1', 'doc1', 'summary')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('DocumentsService.adjustTone', () => {
  it('re-runs prose, logs, and snapshots a tone-adjust version', async () => {
    const { svc, llm, prisma, txObj } = makeDeps();
    await svc.adjustTone('org1', 'job1', 'doc1', 'premium' as any, RES);
    expect(llm.adjustToneProse).toHaveBeenCalled();
    expect(prisma.generationLog.create).toHaveBeenCalled();
    expect(txObj.documentVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ label: 'tone-adjust' }) }),
    );
  });

  it('handles a doc with null contentJson', async () => {
    const { svc, llm } = makeDeps({
      prisma: { document: { findFirst: jest.fn().mockResolvedValue({ id: 'doc1', jobId: 'job1', type: 'proposal', version: 1, contentJson: null }), update: jest.fn() } },
    });
    await svc.adjustTone('org1', 'job1', 'doc1', 'premium' as any);
    expect(llm.adjustToneProse).toHaveBeenCalled();
  });

  it('releases quota on failure', async () => {
    const { svc, prisma } = makeDeps({ llm: { adjustToneProse: jest.fn().mockRejectedValue(new Error('x')) } });
    await expect(svc.adjustTone('org1', 'job1', 'doc1', 'premium' as any, RES)).rejects.toThrow('x');
    expect(prisma.quotaPeriod.updateMany).toHaveBeenCalled();
  });

  it('throws NOT_FOUND when profile missing', async () => {
    const { svc } = makeDeps({ prisma: { profile: { findUnique: jest.fn().mockResolvedValue(null) } } });
    await expect(svc.adjustTone('org1', 'job1', 'doc1', 'premium' as any)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('DocumentsService.adjustPricing', () => {
  it('clamps an above-range price down to priceMax', async () => {
    const { svc, txObj } = makeDeps({ llm: { regenerateSection: jest.fn().mockResolvedValue({ ...GEN, key: 'pricing', value: 999999 }) } });
    await svc.adjustPricing('org1', 'job1', 'doc1', RES);
    expect(txObj.document.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ contentJson: expect.objectContaining({ priceUsd: 1000 }) }) }),
    );
  });

  it('clamps a below-range price up to priceMin', async () => {
    const { svc, txObj } = makeDeps({ llm: { regenerateSection: jest.fn().mockResolvedValue({ ...GEN, key: 'pricing', value: 5 }) } });
    await svc.adjustPricing('org1', 'job1', 'doc1');
    expect(txObj.document.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ contentJson: expect.objectContaining({ priceUsd: 100 }) }) }),
    );
  });

  it('keeps an in-range price (rounded)', async () => {
    const { svc, txObj } = makeDeps({ llm: { regenerateSection: jest.fn().mockResolvedValue({ ...GEN, key: 'pricing', value: 500.6 }) } });
    await svc.adjustPricing('org1', 'job1', 'doc1');
    expect(txObj.document.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ contentJson: expect.objectContaining({ priceUsd: 501 }) }) }),
    );
  });

  it('falls back to priceMin when the value is not finite', async () => {
    const { svc, txObj } = makeDeps({ llm: { regenerateSection: jest.fn().mockResolvedValue({ ...GEN, key: 'pricing', value: 'not-a-number' }) } });
    await svc.adjustPricing('org1', 'job1', 'doc1');
    expect(txObj.document.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ contentJson: expect.objectContaining({ priceUsd: 100 }) }) }),
    );
  });

  it('handles a doc with null contentJson', async () => {
    const { svc, txObj } = makeDeps({
      prisma: { document: { findFirst: jest.fn().mockResolvedValue({ id: 'doc1', jobId: 'job1', type: 'proposal', version: 1, contentJson: null }), update: jest.fn() } },
      llm: { regenerateSection: jest.fn().mockResolvedValue({ ...GEN, key: 'pricing', value: 400 }) },
    });
    await svc.adjustPricing('org1', 'job1', 'doc1');
    expect(txObj.document.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ contentJson: expect.objectContaining({ priceUsd: 400 }) }) }),
    );
  });

  it('releases quota on failure', async () => {
    const { svc, prisma } = makeDeps({ llm: { regenerateSection: jest.fn().mockRejectedValue(new Error('fail')) } });
    await expect(svc.adjustPricing('org1', 'job1', 'doc1', RES)).rejects.toThrow('fail');
    expect(prisma.quotaPeriod.updateMany).toHaveBeenCalled();
  });

  it('throws NOT_FOUND when profile missing', async () => {
    const { svc } = makeDeps({ prisma: { profile: { findUnique: jest.fn().mockResolvedValue(null) } } });
    await expect(svc.adjustPricing('org1', 'job1', 'doc1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('DocumentsService share base url', () => {
  const prev = process.env.PROPOSAL_SHARE_BASE_URL;
  const prevWeb = process.env.WEB_ORIGIN;
  afterEach(() => {
    process.env.PROPOSAL_SHARE_BASE_URL = prev;
    process.env.WEB_ORIGIN = prevWeb;
  });

  it('derives the base url from WEB_ORIGIN when explicit var is unset', async () => {
    delete process.env.PROPOSAL_SHARE_BASE_URL;
    process.env.WEB_ORIGIN = 'https://app.example.com,https://other.com';
    const { svc } = makeDeps();
    const r = await svc.share('org1', 'job1', 'doc1');
    expect(r.url).toContain('https://app.example.com/p/');
  });

  it('prefers the explicit PROPOSAL_SHARE_BASE_URL when set (|| short-circuits)', async () => {
    process.env.PROPOSAL_SHARE_BASE_URL = 'https://share.winprop.ai/x';
    process.env.WEB_ORIGIN = 'https://ignored.example.com';
    const { svc } = makeDeps();
    const r = await svc.share('org1', 'job1', 'doc1');
    expect(r.url).toContain('https://share.winprop.ai/x/');
    expect(r.url).not.toContain('ignored');
  });
});
