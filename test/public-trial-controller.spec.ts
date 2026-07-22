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
// Stub for the card-first trial-checkout dependency (3rd ctor arg).
const tc: any = { createCheckoutSession: jest.fn().mockResolvedValue({ url: 'https://checkout.stripe/x' }) };
const dto = (over: any = {}) => ({
  title: 'Marketing site',
  description: 'A 5-page site',
  fingerprint: { visitorId: 'v-1', userAgent: 'UA', timezone: 'UTC', language: 'en', platform: 'Mac' },
  ...over,
});

describe('PublicTrialController', () => {
  it('trial-checkout: delegates to the trial-checkout service and returns the session url', async () => {
    const trial: any = { evaluate: jest.fn(), record: jest.fn() };
    const llm: any = {};
    const svc: any = { createCheckoutSession: jest.fn().mockResolvedValue({ url: 'https://checkout.stripe/session' }) };
    const ctrl = new PublicTrialController(trial, llm, svc);
    const out = await ctrl.startTrialCheckout();
    expect(svc.createCheckoutSession).toHaveBeenCalled();
    expect(out).toEqual({ url: 'https://checkout.stripe/session' });
  });

  it('assess: allowed → returns analysis + remaining (200) and records usage', async () => {
    const trial: any = {
      evaluate: jest.fn().mockResolvedValue({ allowed: true, remaining: { verdicts: 2, proposals: 1 } }),
      record: jest.fn().mockResolvedValue(undefined),
    };
    const llm: any = { analyzeJob: jest.fn().mockResolvedValue({ text: analysisJson, promptTokens: 100, completionTokens: 50 }) };
    const ctrl = new PublicTrialController(trial, llm, tc);
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
    const ctrl = new PublicTrialController(trial, llm, tc);
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
    const ctrl = new PublicTrialController(trial, llm, tc);
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
    const ctrl = new PublicTrialController(trial, llm, tc);
    const res = makeRes();

    const out: any = await ctrl.proposal(dto() as any, req, res as any);
    expect(res.statusCode).toBe(200);
    expect(out.proposal.summary).toBe('A focused engagement.');
    expect(res.cookies[0]).toMatchObject({ name: 'trial_used', value: '1' });
    expect(res.cookies[0].opts).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax' });
    expect(llm.generateProposal).toHaveBeenCalledWith(expect.anything(), expect.anything(), [], { anon: true });
    expect(trial.record).toHaveBeenCalledWith(expect.anything(), '1.2.3.4', 'proposal', 300);
  });

  it('assess: unreadable LLM output → throws (llmUnreadable)', async () => {
    const trial: any = { evaluate: jest.fn().mockResolvedValue({ allowed: true, remaining: { verdicts: 2, proposals: 1 } }), record: jest.fn() };
    const llm: any = { analyzeJob: jest.fn().mockResolvedValue({ text: 'not json', promptTokens: 1, completionTokens: 1 }) };
    const ctrl = new PublicTrialController(trial, llm, tc);
    await expect(ctrl.assess(dto() as any, req, makeRes() as any)).rejects.toBeInstanceOf(AppException);
    expect(trial.record).not.toHaveBeenCalled();
  });

  it('assess: incomplete LLM output (no objective) → throws (llmIncomplete)', async () => {
    const trial: any = { evaluate: jest.fn().mockResolvedValue({ allowed: true, remaining: { verdicts: 2, proposals: 1 } }), record: jest.fn() };
    const llm: any = { analyzeJob: jest.fn().mockResolvedValue({ text: JSON.stringify({ recommendation: 'apply' }), promptTokens: 1, completionTokens: 1 }) };
    const ctrl = new PublicTrialController(trial, llm, tc);
    await expect(ctrl.assess(dto() as any, req, makeRes() as any)).rejects.toBeInstanceOf(AppException);
  });

  it('proposal: unreadable / incomplete LLM output → throws', async () => {
    const trial: any = { evaluate: jest.fn().mockResolvedValue({ allowed: true, remaining: { verdicts: 2, proposals: 0 } }), record: jest.fn() };
    const unreadable: any = { generateProposal: jest.fn().mockResolvedValue({ text: '<<<', promptTokens: 1, completionTokens: 1 }) };
    await expect(new PublicTrialController(trial, unreadable, tc).proposal(dto() as any, req, makeRes() as any)).rejects.toBeInstanceOf(AppException);
    const incomplete: any = { generateProposal: jest.fn().mockResolvedValue({ text: JSON.stringify({ scope: [] }), promptTokens: 1, completionTokens: 1 }) };
    await expect(new PublicTrialController(trial, incomplete, tc).proposal(dto() as any, req, makeRes() as any)).rejects.toBeInstanceOf(AppException);
  });

  it('assess: falls back to the UA header and reads country headers when fingerprint fields are absent', async () => {
    const trial: any = {
      evaluate: jest.fn().mockResolvedValue({ allowed: true, remaining: { verdicts: 2, proposals: 1 } }),
      record: jest.fn().mockResolvedValue(undefined),
    };
    const llm: any = { analyzeJob: jest.fn().mockResolvedValue({ text: analysisJson, promptTokens: 1, completionTokens: 1 }) };
    const ctrl = new PublicTrialController(trial, llm, tc);
    const bareReq: any = { headers: { 'user-agent': 'HeaderUA', 'x-vercel-ip-country': 'US' }, ip: '4.4.4.4' };
    await ctrl.assess(dto({ fingerprint: { visitorId: 'only-id' } }) as any, bareReq, makeRes() as any);
    const sigArg = trial.record.mock.calls[0][0];
    expect(sigArg).toMatchObject({ fingerprint: 'only-id', userAgent: 'HeaderUA', timezone: '', language: '', platform: '', country: 'US' });
  });

  it('assess: reads cf-ipcountry header (cf takes precedence) for country', async () => {
    const trial: any = {
      evaluate: jest.fn().mockResolvedValue({ allowed: true, remaining: { verdicts: 2, proposals: 1 } }),
      record: jest.fn().mockResolvedValue(undefined),
    };
    const llm: any = { analyzeJob: jest.fn().mockResolvedValue({ text: analysisJson, promptTokens: 1, completionTokens: 1 }) };
    const ctrl = new PublicTrialController(trial, llm, tc);
    const cfReq: any = { headers: { 'cf-ipcountry': 'DE', 'x-vercel-ip-country': 'US' }, ip: '5.5.5.5' };
    await ctrl.assess(dto({ fingerprint: { visitorId: 'id', userAgent: 'FP-UA' } }) as any, cfReq, makeRes() as any);
    const sigArg = trial.record.mock.calls[0][0];
    // cf-ipcountry wins over vercel; fingerprint.userAgent wins over the header.
    expect(sigArg).toMatchObject({ userAgent: 'FP-UA', country: 'DE' });
  });

  it('assess: no country headers → country is undefined', async () => {
    const trial: any = {
      evaluate: jest.fn().mockResolvedValue({ allowed: true, remaining: { verdicts: 2, proposals: 1 } }),
      record: jest.fn().mockResolvedValue(undefined),
    };
    const llm: any = { analyzeJob: jest.fn().mockResolvedValue({ text: analysisJson, promptTokens: 1, completionTokens: 1 }) };
    const ctrl = new PublicTrialController(trial, llm, tc);
    const bareReq: any = { headers: {}, ip: '6.6.6.6' };
    await ctrl.assess(dto() as any, bareReq, makeRes() as any);
    const sigArg = trial.record.mock.calls[0][0];
    expect(sigArg.country).toBeUndefined();
  });

  it('assess: no fingerprint UA and no header UA → empty string', async () => {
    const trial: any = {
      evaluate: jest.fn().mockResolvedValue({ allowed: true, remaining: { verdicts: 2, proposals: 1 } }),
      record: jest.fn().mockResolvedValue(undefined),
    };
    const llm: any = { analyzeJob: jest.fn().mockResolvedValue({ text: analysisJson, promptTokens: 1, completionTokens: 1 }) };
    const ctrl = new PublicTrialController(trial, llm, tc);
    const bareReq: any = { headers: {}, ip: '7.7.7.7' };
    await ctrl.assess(dto({ fingerprint: { visitorId: 'id' } }) as any, bareReq, makeRes() as any);
    const sigArg = trial.record.mock.calls[0][0];
    expect(sigArg.userAgent).toBe('');
  });

  it('proposal: filled honeypot → rejected (400) before evaluate/LLM', async () => {
    const trial: any = { evaluate: jest.fn(), record: jest.fn() };
    const llm: any = { generateProposal: jest.fn() };
    const ctrl = new PublicTrialController(trial, llm, tc);
    await expect(ctrl.proposal(dto({ website: 'http://spam' }) as any, req, makeRes() as any)).rejects.toBeInstanceOf(AppException);
    expect(trial.evaluate).not.toHaveBeenCalled();
    expect(llm.generateProposal).not.toHaveBeenCalled();
  });

  it('proposal: not-allowed → 402, no cookie, no LLM call', async () => {
    const trial: any = {
      evaluate: jest.fn().mockResolvedValue({ allowed: false, reason: 'proposal_used', remaining: { verdicts: 2, proposals: 0 } }),
      record: jest.fn(),
    };
    const llm: any = { generateProposal: jest.fn() };
    const ctrl = new PublicTrialController(trial, llm, tc);
    const res = makeRes();

    const out: any = await ctrl.proposal(dto() as any, req, res as any);
    expect(res.statusCode).toBe(402);
    expect(out).toEqual({ reason: 'proposal_used', remaining: { verdicts: 2, proposals: 0 } });
    expect(res.cookies).toHaveLength(0);
    expect(llm.generateProposal).not.toHaveBeenCalled();
  });
});
