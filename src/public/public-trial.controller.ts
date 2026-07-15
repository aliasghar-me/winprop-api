import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { LlmService } from '../llm/llm.service';
import { AppException } from '../common/errors/app-exception';
import { clientIp } from '../common/net/client-ip';
import { TrialThrottled } from '../common/throttler/trial-throttled.decorator';
import { TrialService, type TrialSignals } from '../trial/trial.service';
import { TrialCheckoutService } from '../auth/trial-checkout.service';
import { NEUTRAL_PROFILE } from './neutral-profile';
import { PublicAssessDto } from './dto/public-assess.dto';
import { PublicAssessResultDto, PublicProposalResultDto } from './dto/public-trial-result.dto';
import { TrialCheckoutResultDto } from './dto/trial-checkout-result.dto';

// Anonymous free-trial funnel: lets a NON-authenticated visitor get the
// "Should I Apply?" verdict + one proposal without signing up, tracked/limited
// server-side (TrialService budget + fraud score) on top of the strict per-IP /
// per-fingerprint throttlers. The platform-funded LLM spend is hard-capped by
// LLM_ANON_DAILY_USD_CAP (the `{ anon: true }` path in LlmService).
@ApiTags('public')
@Controller('public')
export class PublicTrialController {
  constructor(
    private trial: TrialService,
    private llm: LlmService,
    private trialCheckout: TrialCheckoutService,
  ) {}

  // Card-first $0 trial: create a Stripe Checkout Session (card captured, 1-day
  // trial → Starter). No auth/org yet — the account is provisioned on claim-trial.
  @Post('trial-checkout')
  @HttpCode(200)
  @TrialThrottled()
  @ApiOkResponse({ type: TrialCheckoutResultDto })
  startTrialCheckout(): Promise<TrialCheckoutResultDto> {
    return this.trialCheckout.createCheckoutSession();
  }

  @Post('assess')
  @HttpCode(200)
  @TrialThrottled()
  @ApiOkResponse({ type: PublicAssessResultDto })
  async assess(
    @Body() dto: PublicAssessDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublicAssessResultDto | { reason?: string; remaining: { verdicts: number; proposals: number } }> {
    this.rejectHoneypot(dto.website);
    const { sig, ip } = this.readSignals(dto, req);

    const decision = await this.trial.evaluate(sig, ip, 'verdict');
    if (!decision.allowed) {
      res.status(402);
      return { reason: decision.reason, remaining: decision.remaining };
    }

    const job = { title: dto.title, company: '—', projectDescription: dto.description } as never;
    const gen = await this.llm.analyzeJob(NEUTRAL_PROFILE, job, [], { anon: true });
    let analysis: any;
    try {
      analysis = JSON.parse(gen.text);
    } catch {
      throw new AppException(502, 'LLM_PROVIDER_ERROR', 'errors.llmUnreadable');
    }
    if (!analysis || typeof analysis !== 'object' || typeof analysis.objective !== 'string') {
      throw new AppException(502, 'LLM_PROVIDER_ERROR', 'errors.llmIncomplete');
    }

    await this.trial.record(sig, ip, 'verdict', gen.promptTokens + gen.completionTokens);
    return { analysis, remaining: decision.remaining };
  }

  @Post('proposal')
  @HttpCode(200)
  @TrialThrottled()
  @ApiOkResponse({ type: PublicProposalResultDto })
  async proposal(
    @Body() dto: PublicAssessDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublicProposalResultDto | { reason?: string; remaining: { verdicts: number; proposals: number } }> {
    this.rejectHoneypot(dto.website);
    const { sig, ip } = this.readSignals(dto, req);

    const decision = await this.trial.evaluate(sig, ip, 'proposal');
    if (!decision.allowed) {
      res.status(402);
      return { reason: decision.reason, remaining: decision.remaining };
    }

    const job = { title: dto.title, company: '—', projectDescription: dto.description } as never;
    const gen = await this.llm.generateProposal(NEUTRAL_PROFILE, job, [], { anon: true });
    let proposal: any;
    try {
      proposal = JSON.parse(gen.text);
    } catch {
      throw new AppException(502, 'LLM_PROVIDER_ERROR', 'errors.llmUnreadable');
    }
    if (!proposal || typeof proposal !== 'object' || typeof proposal.summary !== 'string') {
      throw new AppException(502, 'LLM_PROVIDER_ERROR', 'errors.llmIncomplete');
    }

    await this.trial.record(sig, ip, 'proposal', gen.promptTokens + gen.completionTokens);
    // Signal to the frontend (and a soft second gate) that the free proposal is spent.
    res.cookie('trial_used', '1', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 365,
    });
    return { proposal, remaining: decision.remaining };
  }

  // Honeypot: a human never fills `website` (visually hidden). Reject as a generic
  // bad request so scrapers can't distinguish it from ordinary validation.
  private rejectHoneypot(website?: string) {
    if (website && website.trim().length > 0) {
      throw new AppException(400, 'VALIDATION', 'errors.badRequest');
    }
  }

  private readSignals(dto: PublicAssessDto, req: Request): { sig: TrialSignals; ip: string } {
    const fp = dto.fingerprint;
    const ua = fp.userAgent ?? (req.headers['user-agent'] as string) ?? '';
    const country =
      (req.headers['cf-ipcountry'] as string) ||
      (req.headers['x-vercel-ip-country'] as string) ||
      undefined;
    const sig: TrialSignals = {
      fingerprint: fp.visitorId,
      userAgent: ua,
      timezone: fp.timezone ?? '',
      language: fp.language ?? '',
      platform: fp.platform ?? '',
      country,
    };
    return { sig, ip: clientIp(req) };
  }
}
