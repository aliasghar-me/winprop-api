import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';

// Raw signals collected from an anonymous visitor. NONE of these are ever persisted
// in the clear — they are hashed before they touch the DB (privacy + anti-abuse).
export interface TrialSignals {
  fingerprint: string; // client-side visitor id (e.g. FingerprintJS visitorId)
  userAgent: string;
  timezone: string;
  language: string;
  platform: string;
  country?: string; // coarse, header-derived (cf-ipcountry / x-vercel-ip-country)
}

export type TrialAction = 'verdict' | 'proposal';
export type TrialDenyReason = 'budget' | 'fraud' | 'proposal_used';

export interface TrialEvaluation {
  allowed: boolean;
  reason?: TrialDenyReason;
  remaining: { verdicts: number; proposals: number };
}

// Free-trial budget: an anonymous visitor gets THIS many "Should I Apply?" verdicts
// and THIS many generated proposals before the signup wall.
export const TRIAL_VERDICT_CAP = 3;
export const TRIAL_PROPOSAL_CAP = 1;

// Fraud-score threshold: a request scoring ABOVE this is denied with reason 'fraud'.
export const FRAUD_DENY_THRESHOLD = 70;

@Injectable()
export class TrialService {
  private readonly logger = new Logger(TrialService.name);
  constructor(private prisma: PrismaService, private crypto: CryptoService) {}

  // Deterministic keyed SHA-256 (HMAC) so the same input always maps to the same
  // hash (required to back the UNIQUE deviceId + the blind-index lookups) while a
  // DB leak cannot be reversed into raw IPs / fingerprints.
  hash(value: string): string {
    return this.crypto.hmac(value ?? '');
  }

  // A stable "device" identity derived from the fingerprint + environment signals.
  // Spoofing any one signal mints a new deviceId — which the fraud score catches
  // when the underlying fingerprint is reused across those "devices".
  deviceId(sig: TrialSignals): string {
    return this.hash(
      [sig.fingerprint, sig.userAgent, sig.timezone, sig.language, sig.platform]
        .map((v) => v ?? '')
        .join('|'),
    );
  }

  // Decide whether this anonymous request may proceed. Read-only: it inspects the
  // stored counters + cross-signal overlap but does NOT mutate — record() commits
  // the consumption after the LLM call succeeds. `remaining` is projected AFTER this
  // action (so an allowed verdict already reflects one fewer verdict left).
  async evaluate(sig: TrialSignals, ip: string, action: TrialAction): Promise<TrialEvaluation> {
    const deviceId = this.deviceId(sig);
    const fingerprintHash = this.hash(sig.fingerprint);
    const ipHash = this.hash(ip);
    const uaHash = this.hash(sig.userAgent);

    const row = await this.prisma.trialUsage.findUnique({ where: { deviceId } });
    const verdictCount = row?.verdictCount ?? 0;
    const proposalCount = row?.proposalCount ?? 0;

    // ── Fraud score (weighted). Denies ABOVE FRAUD_DENY_THRESHOLD (70). Weights:
    //   +50  another deviceId already shares THIS fingerprint  → fingerprint reused
    //        across "devices" is the classic free-trial-farming evasion signal.
    //   +20  more than 5 DISTINCT deviceIds share this IP       → device farming.
    //   +15  another deviceId shares this exact user-agent      → weak reuse signal.
    //   +5   more than 3 other rows share this IP               → baseline noise.
    // Tuning: a normal office (≤5 devices behind one NAT/IP, each a distinct
    // fingerprint) scores at most 5 (+15 if everyone runs the identical UA) = 20 —
    // well under 70. A fingerprint-spoofer farming trials (same fingerprint reused
    // across >5 minted deviceIds on one IP) scores 50+20+5 = 75 > 70 → denied.
    const [fpOthers, ipRows, uaOthers] = await Promise.all([
      this.prisma.trialUsage.count({ where: { fingerprintHash, deviceId: { not: deviceId } } }),
      this.prisma.trialUsage.findMany({ where: { ipHash }, select: { deviceId: true } }),
      this.prisma.trialUsage.count({ where: { uaHash, deviceId: { not: deviceId } } }),
    ]);
    const distinctIpDevices = new Set(ipRows.map((r) => r.deviceId));
    distinctIpDevices.add(deviceId); // count this request's device too
    const otherIpRows = ipRows.filter((r) => r.deviceId !== deviceId).length;

    let fraudScore = 0;
    if (fpOthers > 0) fraudScore += 50;
    if (distinctIpDevices.size > 5) fraudScore += 20;
    if (uaOthers > 0) fraudScore += 15;
    if (otherIpRows > 3) fraudScore += 5;

    if (fraudScore > FRAUD_DENY_THRESHOLD) {
      return { allowed: false, reason: 'fraud', remaining: this.remaining(verdictCount, proposalCount) };
    }

    // ── Budget.
    if (action === 'verdict') {
      if (verdictCount >= TRIAL_VERDICT_CAP) {
        return { allowed: false, reason: 'budget', remaining: this.remaining(verdictCount, proposalCount) };
      }
      return { allowed: true, remaining: this.remaining(verdictCount + 1, proposalCount) };
    }
    // action === 'proposal'
    if (proposalCount >= TRIAL_PROPOSAL_CAP) {
      return { allowed: false, reason: 'proposal_used', remaining: this.remaining(verdictCount, proposalCount) };
    }
    return { allowed: true, remaining: this.remaining(verdictCount, proposalCount + 1) };
  }

  private remaining(verdictCount: number, proposalCount: number): { verdicts: number; proposals: number } {
    return {
      verdicts: Math.max(0, TRIAL_VERDICT_CAP - verdictCount),
      proposals: Math.max(0, TRIAL_PROPOSAL_CAP - proposalCount),
    };
  }

  // Commit a consumed action: increment the relevant counter (+ token spend), flip
  // trialUsed once the single proposal is used, and refresh the stored hashes /
  // country. Best-effort — a bookkeeping failure must not fail the request that
  // already produced a result, so errors are logged and swallowed.
  async record(sig: TrialSignals, ip: string, action: TrialAction, tokensUsed: number): Promise<void> {
    try {
      const deviceId = this.deviceId(sig);
      const fingerprintHash = this.hash(sig.fingerprint);
      const ipHash = this.hash(ip);
      const uaHash = this.hash(sig.userAgent);
      const country = sig.country ?? null;
      const tokens = Number.isFinite(tokensUsed) && tokensUsed > 0 ? Math.floor(tokensUsed) : 0;

      const verdictInc = action === 'verdict' ? 1 : 0;
      const proposalInc = action === 'proposal' ? 1 : 0;

      const existing = await this.prisma.trialUsage.findUnique({
        where: { deviceId },
        select: { proposalCount: true },
      });
      const proposalTotal = (existing?.proposalCount ?? 0) + proposalInc;

      await this.prisma.trialUsage.upsert({
        where: { deviceId },
        create: {
          deviceId,
          fingerprintHash,
          ipHash,
          uaHash,
          country,
          verdictCount: verdictInc,
          proposalCount: proposalInc,
          tokenUsed: tokens,
          trialUsed: proposalTotal >= TRIAL_PROPOSAL_CAP,
        },
        update: {
          fingerprintHash,
          ipHash,
          uaHash,
          ...(country ? { country } : {}),
          verdictCount: { increment: verdictInc },
          proposalCount: { increment: proposalInc },
          tokenUsed: { increment: tokens },
          trialUsed: proposalTotal >= TRIAL_PROPOSAL_CAP,
        },
      });
    } catch (e: any) {
      this.logger.warn(`TrialUsage.record failed (best-effort): ${e?.message ?? e}`);
    }
  }
}
