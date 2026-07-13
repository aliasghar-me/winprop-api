import { PublicTrialController } from '../src/public/public-trial.controller';
import { AppException } from '../src/common/errors/app-exception';

const analysisJson = JSON.stringify({
  objective: 'Build a marketing site',
  recommendation: 'apply',
  fit: { portfolio: 70, skills: 80, budget: 75, competition: 'Medium' },
  expectedRoiUsdPerHour: 200,
  redFlags: ['none'],
});
const proposalJson = JSON.stringify({
  summary: 'A focused engagement.',
  scope: ['Discovery'],
  timelineWeeks: 6,
  priceUsd: 12000,
  closing: 'Let us begin.',
});

function makeRes() {
  return {
    statusCode: 200,
    cookies: [] as any[],
    status(code: number) { this.statusCode = code; return this; },
    cookie(name: string, value: string, opts: any) { this.cookies.push({ name, value, opts }); return this; },
  };
}
const req: any = { headers: {}, ip: '1.2.3.4' };
const dto = (over: any = {}) => ({
  title: 'Marketing site',
  description: 'A 5-page site',
  fingerprint: { visitorId: 'v-1', userAgent: 'UA', timezone: 'UTC', language: 'en', platform: 'Mac' },
  ...over,
});

describe('PublicTrialController', () => {
  it('assess: allowed → returns analysis + remaining (200) and records usage', async () => {
    const trial: any = {
      evaluate: jest.fn().mockResolvedValue({ allowed: true, remaining: { verdicts: 2, proposals: 1 } }),
      record: jest.fn().mockResolvedValue(undefined),
    };
    const llm: any = { analyzeJob: jest.fn().mockResolvedValue({ text: analysisJson, promptTokens: 100, completionTokens: 50 }) };
    const ctrl = new PublicTrialController(trial, llm);
    const res = makeRes();

    const out: any = await ctrl.assess(dto() as any, req, res as any);
    expect(res.statusCode).toBe(200);
    expect(out.analysis.objective).toBe('Build a marketing site');
    expect(out.remaining).toEqual({ verdicts: 2, proposals: 1 });
    expect(llm.analyzeJob).toHaveBeenCalledWith(expect.anything(), expect.anything(), [], { anon: true });
    expect(trial.record).toHaveBeenCalledWith(expect.anything(), '1.2.3.4', 'verdict', 150);
  });

  it('assess: not-allowed → 402 with { reason, remaining } and no LLM call', async () => {
    const trial: any = {
      evaluate: jest.fn().mockResolvedValue({ allowed: false, reason: 'budget', remaining: { verdicts: 0, proposals: 1 } }),
      record: jest.fn(),
    };
    const llm: any = { analyzeJob: jest.fn() };
    const ctrl = new PublicTrialController(trial, llm);
    const res = makeRes();

    const out: any = await ctrl.assess(dto() as any, req, res as any);
    expect(res.statusCode).toBe(402);
    expect(out).toEqual({ reason: 'budget', remaining: { verdicts: 0, proposals: 1 } });
    expect(llm.analyzeJob).not.toHaveBeenCalled();
    expect(trial.record).not.toHaveBeenCalled();
  });

  it('assess: filled honeypot → rejected (400) before evaluate/LLM', async () => {
    const trial: any = { evaluate: jest.fn(), record: jest.fn() };
    const llm: any = { analyzeJob: jest.fn() };
    const ctrl = new PublicTrialController(trial, llm);
    const res = makeRes();
    await expect(ctrl.assess(dto({ website: 'http://spam' }) as any, req, res as any)).rejects.toBeInstanceOf(AppException);
    expect(trial.evaluate).not.toHaveBeenCalled();
    expect(llm.analyzeJob).not.toHaveBeenCalled();
  });

  it('proposal: allowed → returns proposal, sets trial_used cookie, records usage', async () => {
    const trial: any = {
      evaluate: jest.fn().mockResolvedValue({ allowed: true, remaining: { verdicts: 2, proposals: 0 } }),
      record: jest.fn().mockResolvedValue(undefined),
    };
    const llm: any = { generateProposal: jest.fn().mockResolvedValue({ text: proposalJson, promptTokens: 200, completionTokens: 100 }) };
    const ctrl = new PublicTrialController(trial, llm);
    const res = makeRes();

    const out: any = await ctrl.proposal(dto() as any, req, res as any);
    expect(res.statusCode).toBe(200);
    expect(out.proposal.summary).toBe('A focused engagement.');
    expect(res.cookies[0]).toMatchObject({ name: 'trial_used', value: '1' });
    expect(res.cookies[0].opts).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax' });
    expect(llm.generateProposal).toHaveBeenCalledWith(expect.anything(), expect.anything(), [], { anon: true });
    expect(trial.record).toHaveBeenCalledWith(expect.anything(), '1.2.3.4', 'proposal', 300);
  });

  it('proposal: not-allowed → 402, no cookie, no LLM call', async () => {
    const trial: any = {
      evaluate: jest.fn().mockResolvedValue({ allowed: false, reason: 'proposal_used', remaining: { verdicts: 2, proposals: 0 } }),
      record: jest.fn(),
    };
    const llm: any = { generateProposal: jest.fn() };
    const ctrl = new PublicTrialController(trial, llm);
    const res = makeRes();

    const out: any = await ctrl.proposal(dto() as any, req, res as any);
    expect(res.statusCode).toBe(402);
    expect(out).toEqual({ reason: 'proposal_used', remaining: { verdicts: 2, proposals: 0 } });
    expect(res.cookies).toHaveLength(0);
    expect(llm.generateProposal).not.toHaveBeenCalled();
  });
});
