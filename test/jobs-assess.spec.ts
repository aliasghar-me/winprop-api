import { JobsService } from '../src/jobs/jobs.service';

// Unit tests for the "Should I Apply?" additions: assess (create-from-text +
// analyze), deriveTitle, and outcome recording on update. Hand-rolled fakes, no DB.

const GEN = { provider: 'anthropic', model: 'claude-opus-4-8', promptTokens: 100, completionTokens: 50, costUsd: 0.01, priceMapVersion: 'v1' };
const PROFILE = { orgId: 'org1', agencyName: 'A', tone: 'premium', services: ['web'], skills: ['x'], priceMin: 100, priceMax: 1000 };
const ORG = { id: 'org1', profession: 'design' };
const ANALYSIS = { objective: 'win the deal', recommendation: 'apply', fit: { portfolio: 80, skills: 85, budget: 80, competition: 'Medium' }, expectedRoiUsdPerHour: 240, redFlags: ['none'] };

function makeDeps(over: { llmText?: string; llmReject?: boolean; created?: any } = {}) {
  const created = over.created ?? { id: 'job-new', title: 'React app build', orgId: 'org1' };
  const dbJob = { create: jest.fn().mockResolvedValue(created), findFirst: jest.fn().mockResolvedValue({ id: 'job1', title: 'X' }) };
  const prisma: any = {
    db: { job: dbJob },
    job: { update: jest.fn().mockResolvedValue({ id: created.id }) },
    profile: { findUnique: jest.fn().mockResolvedValue(PROFILE) },
    org: { findUnique: jest.fn().mockResolvedValue(ORG) },
    generationLog: { create: jest.fn().mockResolvedValue({}) },
    quotaPeriod: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn((arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg))),
  };
  const llm: any = over.llmReject
    ? { analyzeJob: jest.fn().mockRejectedValue(new Error('boom')), extractMemories: jest.fn().mockResolvedValue([]) }
    : { analyzeJob: jest.fn().mockResolvedValue({ ...GEN, text: over.llmText ?? JSON.stringify(ANALYSIS) }), extractMemories: jest.fn().mockResolvedValue([{ category: 'freelancing', key: 'wins_with', value: 'fixed price', confidence: 0.8 }]) };
  const memory: any = { forPrompt: jest.fn().mockResolvedValue([]), recordFact: jest.fn().mockResolvedValue({}), markUsed: jest.fn().mockResolvedValue({ count: 0 }) };
  return { svc: new JobsService(prisma, llm, memory), prisma, llm, dbJob, memory };
}

const RES = { orgId: 'org1', periodStart: new Date('2026-01-01') };

describe('JobsService.assess', () => {
  it('creates a Job from pasted text and returns { job, analysis }', async () => {
    const { svc, dbJob, prisma } = makeDeps();
    const out = await svc.assess('org1', 'Build me a React app\nBudget $8k', RES);
    expect(dbJob.create).toHaveBeenCalledWith({ data: { orgId: 'org1', title: 'Build me a React app', projectDescription: 'Build me a React app\nBudget $8k' } });
    expect(out.analysis.recommendation).toBe('apply');
    expect(out.job.id).toBe('job-new');
    expect(prisma.job.update).toHaveBeenCalled(); // intelligenceJson persisted
  });

  it('derives the title from the first non-empty line, capped, with a fallback', async () => {
    const { svc, dbJob } = makeDeps();
    await svc.assess('org1', '   \n\n  Senior Next.js developer needed  \nrest', RES);
    expect(dbJob.create.mock.calls[0][0].data.title).toBe('Senior Next.js developer needed');

    const long = 'x'.repeat(200);
    await svc.assess('org1', long, RES);
    expect(dbJob.create.mock.calls[1][0].data.title.length).toBe(120);

    await svc.assess('org1', '    ', RES);
    expect(dbJob.create.mock.calls[2][0].data.title).toBe('Untitled opportunity');
  });

  it('releases the quota reservation and rethrows when the LLM fails', async () => {
    const { svc, prisma } = makeDeps({ llmReject: true });
    await expect(svc.assess('org1', 'job text', RES)).rejects.toThrow();
    expect(prisma.quotaPeriod.updateMany).toHaveBeenCalled();
  });

  it('maps unreadable LLM output to a 502 (and releases quota)', async () => {
    const { svc, prisma } = makeDeps({ llmText: 'not json' });
    await expect(svc.assess('org1', 'job text', RES)).rejects.toMatchObject({ code: 'LLM_PROVIDER_ERROR', translationKey: 'errors.llmUnreadable' });
    expect(prisma.quotaPeriod.updateMany).toHaveBeenCalled();
  });

  it('rejects incomplete analysis (missing objective) with 502', async () => {
    const { svc } = makeDeps({ llmText: JSON.stringify({ recommendation: 'apply' }) });
    await expect(svc.assess('org1', 'job text', RES)).rejects.toMatchObject({ code: 'LLM_PROVIDER_ERROR', translationKey: 'errors.llmIncomplete' });
  });
});

describe('JobsService.update — outcome recording', () => {
  it('persists status, wonAmountUsd and outcomeReason', async () => {
    const { svc, prisma } = makeDeps();
    await svc.update('org1', 'job1', { status: 'won', wonAmountUsd: 5000, outcomeReason: 'short proposal, fixed price' } as any);
    const data = prisma.job.update.mock.calls[0][0].data;
    expect(data.status).toBe('won');
    expect(data.wonAmountUsd).toBe(5000);
    expect(data.outcomeReason).toBe('short proposal, fixed price');
  });

  it('auto-captures durable facts from a won/lost outcome reason (learning loop)', async () => {
    const { svc, llm, memory } = makeDeps();
    await svc.update('org1', 'job1', { status: 'won', wonAmountUsd: 5000, outcomeReason: 'won because I highlighted my fintech experience' } as any);
    expect(llm.extractMemories).toHaveBeenCalledWith('won because I highlighted my fintech experience');
    expect(memory.recordFact).toHaveBeenCalledWith('org1', expect.objectContaining({ key: 'wins_with', source: 'outcome' }));
  });

  it('does NOT auto-capture on a non-outcome update or when no reason is given', async () => {
    const { svc, llm } = makeDeps();
    await svc.update('org1', 'job1', { status: 'sent' } as any);
    await svc.update('org1', 'job1', { status: 'won' } as any); // no reason
    expect(llm.extractMemories).not.toHaveBeenCalled();
  });
});
