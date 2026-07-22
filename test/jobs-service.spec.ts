import { JobsService } from '../src/jobs/jobs.service';

// Hand-rolled fakes for JobsService's deps (PrismaService + tenant-scoped
// prisma.db accessor, LlmService). No Nest DI, no Postgres. We fake `prisma.db`
// directly so the tenant-scoped code path runs without AsyncLocalStorage.

const GEN = {
  provider: 'anthropic',
  model: 'claude-opus-4-8',
  promptTokens: 100,
  completionTokens: 50,
  costUsd: 0.01,
  priceMapVersion: 'v1',
};

const PROFILE = { orgId: 'org1', agencyName: 'A', tone: 'premium', services: ['web'], skills: ['x'], priceMin: 100, priceMax: 1000 };
const ORG = { id: 'org1', profession: 'design' };
const JOB = { id: 'job1', title: 'Landing page', company: 'ACME' };

function makeDeps(overrides: { prisma?: any; llm?: any } = {}) {
  const dbJob = {
    findFirst: jest.fn().mockResolvedValue(JOB),
    findMany: jest.fn().mockResolvedValue([JOB]),
    create: jest.fn().mockResolvedValue({ id: 'job-new', title: 'Landing page' }),
  };
  const prisma: any = {
    db: { job: dbJob, ...(overrides.prisma?.db ?? {}) },
    job: { update: jest.fn().mockResolvedValue({ id: 'job1', updated: true }) },
    profile: { findUnique: jest.fn().mockResolvedValue(PROFILE) },
    org: { findUnique: jest.fn().mockResolvedValue(ORG) },
    generationLog: { create: jest.fn().mockResolvedValue({}) },
    quotaPeriod: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn((arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg))),
    ...overrides.prisma,
  };
  // keep db reference stable even if overrides.prisma replaced top-level keys
  if (!overrides.prisma?.db) prisma.db = { job: dbJob };
  const llm: any = {
    analyzeJob: jest.fn().mockResolvedValue({ ...GEN, text: JSON.stringify({ objective: 'win the deal' }) }),
    extractMemories: jest.fn().mockResolvedValue([]),
    ...overrides.llm,
  };
  const memory: any = { forPrompt: jest.fn().mockResolvedValue([]), recordFact: jest.fn().mockResolvedValue({}), markUsed: jest.fn().mockResolvedValue({ count: 0 }) };
  const svc = new JobsService(prisma, llm, memory);
  return { svc, prisma, llm, dbJob, memory };
}

const RES = { orgId: 'org1', periodStart: new Date('2026-01-01') };

describe('JobsService.getOwned', () => {
  it('returns the job when found, including applied and outcome fields', async () => {
    const jobRow = { ...JOB, wonAmountUsd: null, outcomeReason: null, _count: { documents: 0 } };
    const findFirst = jest.fn().mockResolvedValue(jobRow);
    const { svc } = makeDeps({ prisma: { db: { job: { findFirst, findMany: jest.fn(), create: jest.fn() } } } });
    const job = await svc.getOwned('org1', 'job1');
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'job1', orgId: 'org1' },
      include: { _count: { select: { documents: true } } },
    });
    expect(job).toMatchObject({ ...JOB, wonAmountUsd: null, outcomeReason: null, applied: false });
  });

  it('throws NOT_FOUND when the job is missing (or belongs to another org)', async () => {
    const { svc } = makeDeps({ prisma: { db: { job: { findFirst: jest.fn().mockResolvedValue(null) } } } });
    await expect(svc.getOwned('org1', 'nope')).rejects.toMatchObject({ code: 'NOT_FOUND', translationKey: 'errors.jobNotFound' });
  });
});

describe('JobsService.list', () => {
  it('lists org jobs newest-first and includes documents count', () => {
    const { svc, dbJob } = makeDeps();
    svc.list('org1');
    expect(dbJob.findMany).toHaveBeenCalledWith({
      where: { orgId: 'org1' },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { documents: true } } },
    });
  });

  it('maps wonAmountUsd and outcomeReason onto returned rows', async () => {
    const jobRow = { ...JOB, wonAmountUsd: 5000, outcomeReason: 'Great fit', _count: { documents: 0 } };
    const { svc } = makeDeps({ prisma: { db: { job: { findMany: jest.fn().mockResolvedValue([jobRow]), findFirst: jest.fn().mockResolvedValue(JOB), create: jest.fn() } } } });
    const rows = await svc.list('org1');
    expect(rows[0].wonAmountUsd).toBe(5000);
    expect(rows[0].outcomeReason).toBe('Great fit');
  });

  it('sets applied=false when the job has no documents', async () => {
    const jobRow = { ...JOB, wonAmountUsd: null, outcomeReason: null, _count: { documents: 0 } };
    const { svc } = makeDeps({ prisma: { db: { job: { findMany: jest.fn().mockResolvedValue([jobRow]), findFirst: jest.fn().mockResolvedValue(JOB), create: jest.fn() } } } });
    const rows = await svc.list('org1');
    expect(rows[0].applied).toBe(false);
  });

  it('sets applied=true when the job has at least one document', async () => {
    const jobRow = { ...JOB, wonAmountUsd: null, outcomeReason: null, _count: { documents: 1 } };
    const { svc } = makeDeps({ prisma: { db: { job: { findMany: jest.fn().mockResolvedValue([jobRow]), findFirst: jest.fn().mockResolvedValue(JOB), create: jest.fn() } } } });
    const rows = await svc.list('org1');
    expect(rows[0].applied).toBe(true);
  });
});

describe('JobsService.create', () => {
  it('creates a job with trimmed title and rich fields', async () => {
    const { svc, dbJob } = makeDeps();
    await svc.create('org1', { title: '  Landing page  ', clientName: 'Bob', budget: '5k' } as any);
    expect(dbJob.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ orgId: 'org1', title: 'Landing page', company: '—', clientName: 'Bob', budget: '5k' }) }),
    );
  });

  it('defaults company to em-dash and keeps a provided company', async () => {
    const { svc, dbJob } = makeDeps();
    await svc.create('org1', { title: 'X', company: 'ACME' } as any);
    expect(dbJob.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ company: 'ACME' }) }));
  });

  it('throws DUPLICATE_NAME when the pre-check finds a clashing title', async () => {
    const { svc } = makeDeps({ prisma: { $queryRaw: jest.fn().mockResolvedValue([{ id: 'other' }]) } });
    await expect(svc.create('org1', { title: 'Dup' } as any)).rejects.toMatchObject({ code: 'DUPLICATE_NAME' });
  });

  it('maps a P2002 unique-violation to DUPLICATE_NAME', async () => {
    const { svc } = makeDeps({ prisma: { db: { job: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn().mockRejectedValue({ code: 'P2002' }) } } } });
    await expect(svc.create('org1', { title: 'Race' } as any)).rejects.toMatchObject({ code: 'DUPLICATE_NAME' });
  });

  it('maps a constraint-name error message to DUPLICATE_NAME', async () => {
    const { svc } = makeDeps({ prisma: { db: { job: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn().mockRejectedValue(new Error('job_org_title_uniq violated')) } } } });
    await expect(svc.create('org1', { title: 'Race2' } as any)).rejects.toMatchObject({ code: 'DUPLICATE_NAME' });
  });

  it('maps a 23505 meta code to DUPLICATE_NAME', async () => {
    const { svc } = makeDeps({ prisma: { db: { job: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn().mockRejectedValue({ meta: { code: '23505' } }) } } } });
    await expect(svc.create('org1', { title: 'Race3' } as any)).rejects.toMatchObject({ code: 'DUPLICATE_NAME' });
  });

  it('rethrows an unrelated create error unchanged', async () => {
    const { svc } = makeDeps({ prisma: { db: { job: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn().mockRejectedValue(new Error('db exploded')) } } } });
    await expect(svc.create('org1', { title: 'Ok' } as any)).rejects.toThrow('db exploded');
  });
});

describe('JobsService.update', () => {
  it('updates title/company/status and rich fields', async () => {
    const { svc, prisma } = makeDeps();
    await svc.update('org1', 'job1', { title: '  Renamed ', company: 'New Co', status: 'won', clientEmail: 'a@b.com' } as any);
    expect(prisma.job.update).toHaveBeenCalledWith({
      where: { id: 'job1' },
      data: expect.objectContaining({ title: 'Renamed', company: 'New Co', status: 'won', clientEmail: 'a@b.com' }),
    });
  });

  it('updates without a title (skips the title-free check)', async () => {
    const { svc, prisma } = makeDeps();
    await svc.update('org1', 'job1', { status: 'lost' } as any);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.job.update).toHaveBeenCalledWith({ where: { id: 'job1' }, data: { status: 'lost' } });
  });

  it('runs the duplicate check when a title is supplied', async () => {
    const { svc, prisma } = makeDeps({ prisma: { $queryRaw: jest.fn().mockResolvedValue([{ id: 'clash' }]) } });
    await expect(svc.update('org1', 'job1', { title: 'Taken' } as any)).rejects.toMatchObject({ code: 'DUPLICATE_NAME' });
  });

  it('throws NOT_FOUND when the job to update does not exist', async () => {
    const { svc } = makeDeps({ prisma: { db: { job: { findFirst: jest.fn().mockResolvedValue(null) } } } });
    await expect(svc.update('org1', 'gone', { status: 'won' } as any)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('JobsService.analyze', () => {
  it('generates intelligence, persists it, logs cost', async () => {
    const { svc, prisma, llm } = makeDeps();
    const result = await svc.analyze('org1', 'job1', RES);
    expect(llm.analyzeJob).toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.job.update).toHaveBeenCalledWith({ where: { id: 'job1' }, data: { intelligenceJson: { objective: 'win the deal' } } });
    expect(prisma.generationLog.create).toHaveBeenCalled();
    expect(result).toEqual({ objective: 'win the deal' });
  });

  it('throws NOT_FOUND and releases quota when profile is missing', async () => {
    const { svc, prisma } = makeDeps({ prisma: { profile: { findUnique: jest.fn().mockResolvedValue(null) } } });
    await expect(svc.analyze('org1', 'job1', RES)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(prisma.quotaPeriod.updateMany).toHaveBeenCalled();
  });

  it('throws llmUnreadable on non-JSON output', async () => {
    const { svc } = makeDeps({ llm: { analyzeJob: jest.fn().mockResolvedValue({ ...GEN, text: 'garbage' }) } });
    await expect(svc.analyze('org1', 'job1')).rejects.toMatchObject({ translationKey: 'errors.llmUnreadable' });
  });

  it('throws llmIncomplete when the objective field is missing', async () => {
    const { svc } = makeDeps({ llm: { analyzeJob: jest.fn().mockResolvedValue({ ...GEN, text: JSON.stringify({ foo: 'bar' }) }) } });
    await expect(svc.analyze('org1', 'job1')).rejects.toMatchObject({ translationKey: 'errors.llmIncomplete' });
  });

  it('throws llmIncomplete when the parsed value is not an object', async () => {
    const { svc } = makeDeps({ llm: { analyzeJob: jest.fn().mockResolvedValue({ ...GEN, text: JSON.stringify('nope') }) } });
    await expect(svc.analyze('org1', 'job1')).rejects.toMatchObject({ translationKey: 'errors.llmIncomplete' });
  });

  it('releases quota when the LLM call throws', async () => {
    const { svc, prisma } = makeDeps({ llm: { analyzeJob: jest.fn().mockRejectedValue(new Error('llm down')) } });
    await expect(svc.analyze('org1', 'job1', RES)).rejects.toThrow('llm down');
    expect(prisma.quotaPeriod.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orgId: 'org1' }), data: { used: { decrement: 1 } } }),
    );
  });

  it('does not release quota when no reservation is provided', async () => {
    const { svc, prisma } = makeDeps({ llm: { analyzeJob: jest.fn().mockRejectedValue(new Error('x')) } });
    await expect(svc.analyze('org1', 'job1')).rejects.toThrow('x');
    expect(prisma.quotaPeriod.updateMany).not.toHaveBeenCalled();
  });

  it('swallows a release failure and preserves the original error', async () => {
    const { svc } = makeDeps({
      prisma: { quotaPeriod: { updateMany: jest.fn().mockRejectedValue(new Error('release fail')) } },
      llm: { analyzeJob: jest.fn().mockRejectedValue(new Error('original')) },
    });
    await expect(svc.analyze('org1', 'job1', RES)).rejects.toThrow('original');
  });

  it('throws NOT_FOUND when the job is not owned', async () => {
    const { svc } = makeDeps({ prisma: { db: { job: { findFirst: jest.fn().mockResolvedValue(null) } } } });
    await expect(svc.analyze('org1', 'job1')).rejects.toMatchObject({ code: 'NOT_FOUND', translationKey: 'errors.jobNotFound' });
  });

  it('proceeds when the memory lookup rejects (best-effort empty memories)', async () => {
    const { svc, llm, memory } = makeDeps();
    memory.forPrompt.mockRejectedValueOnce(new Error('memory down'));
    const result = await svc.analyze('org1', 'job1');
    expect(llm.analyzeJob).toHaveBeenCalledWith(expect.anything(), expect.anything(), []);
    expect(result).toEqual({ objective: 'win the deal' });
  });
});

describe('JobsService.assess', () => {
  it('creates a job from pasted text (deriving the title) and returns job + analysis', async () => {
    const { svc, dbJob, llm } = makeDeps();
    const out = await svc.assess('org1', '  Senior React Engineer  \nBuild a dashboard', RES);
    expect(dbJob.create).toHaveBeenCalledWith({
      data: { orgId: 'org1', title: 'Senior React Engineer', projectDescription: 'Senior React Engineer  \nBuild a dashboard' },
    });
    expect(llm.analyzeJob).toHaveBeenCalled();
    expect(out).toEqual({ job: { id: 'job-new', title: 'Landing page' }, analysis: { objective: 'win the deal' } });
  });

  it('falls back to "Untitled opportunity" when the text has no non-empty line', async () => {
    const { svc, dbJob } = makeDeps();
    await svc.assess('org1', '   \n  \n');
    expect(dbJob.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ title: 'Untitled opportunity' }) }),
    );
  });

  it('releases quota and rethrows when analysis fails', async () => {
    const { svc, prisma } = makeDeps({ llm: { analyzeJob: jest.fn().mockRejectedValue(new Error('llm down')) } });
    await expect(svc.assess('org1', 'Some job text', RES)).rejects.toThrow('llm down');
    expect(prisma.quotaPeriod.updateMany).toHaveBeenCalled();
  });

  it('deriveTitle tolerates nullish text (?? "" branch)', () => {
    const { svc } = makeDeps();
    expect((svc as any).deriveTitle(undefined)).toBe('Untitled opportunity');
  });
});

describe('JobsService.update — learning loop', () => {
  it('captures memories from a won outcome with a reason', async () => {
    const facts = [{ text: 'Client valued speed' }];
    const { svc, llm, memory } = makeDeps({ llm: { extractMemories: jest.fn().mockResolvedValue(facts) } });
    await svc.update('org1', 'job1', { status: 'won', outcomeReason: 'Delivered fast' } as any);
    expect(llm.extractMemories).toHaveBeenCalledWith('Delivered fast');
    expect(memory.recordFact).toHaveBeenCalledWith('org1', { text: 'Client valued speed', source: 'outcome' });
  });

  it('captures memories from a lost outcome with a reason', async () => {
    const { svc, llm } = makeDeps({ llm: { extractMemories: jest.fn().mockResolvedValue([]) } });
    await svc.update('org1', 'job1', { status: 'lost', outcomeReason: 'Too expensive' } as any);
    expect(llm.extractMemories).toHaveBeenCalledWith('Too expensive');
  });

  it('does not capture memories when there is no outcome reason', async () => {
    const { svc, llm } = makeDeps();
    await svc.update('org1', 'job1', { status: 'won' } as any);
    expect(llm.extractMemories).not.toHaveBeenCalled();
  });

  it('swallows a memory-capture failure without failing the update', async () => {
    const { svc, prisma } = makeDeps({ llm: { extractMemories: jest.fn().mockRejectedValue(new Error('extract fail')) } });
    const res = await svc.update('org1', 'job1', { status: 'won', outcomeReason: 'reason' } as any);
    expect(res).toEqual({ id: 'job1', updated: true });
    expect(prisma.job.update).toHaveBeenCalled();
  });
});
