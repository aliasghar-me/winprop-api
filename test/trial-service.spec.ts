import { TrialService, TRIAL_VERDICT_CAP, TRIAL_PROPOSAL_CAP, type TrialSignals } from '../src/trial/trial.service';
import { CryptoService } from '../src/common/crypto/crypto.service';

// In-memory fake of the `trialUsage` Prisma delegate: supports the exact operations
// TrialService uses (findUnique/count/findMany/upsert) so we can drive the budget +
// fraud-score logic deterministically without a database.
class FakeTrialTable {
  rows: any[] = [];
  private match(where: any, r: any): boolean {
    for (const [k, v] of Object.entries(where ?? {})) {
      if (v && typeof v === 'object' && 'not' in (v as any)) {
        if (r[k] === (v as any).not) return false;
      } else if (r[k] !== v) {
        return false;
      }
    }
    return true;
  }
  async findUnique({ where }: any) {
    return this.rows.find((r) => r.deviceId === where.deviceId) ?? null;
  }
  async count({ where }: any) {
    return this.rows.filter((r) => this.match(where, r)).length;
  }
  async findMany({ where }: any) {
    return this.rows.filter((r) => this.match(where, r)).map((r) => ({ deviceId: r.deviceId }));
  }
  async upsert({ where, create, update }: any) {
    const existing = this.rows.find((r) => r.deviceId === where.deviceId);
    if (!existing) {
      const row = { verdictCount: 0, proposalCount: 0, tokenUsed: 0, ...create };
      this.rows.push(row);
      return row;
    }
    for (const [k, v] of Object.entries(update)) {
      if (v && typeof v === 'object' && 'increment' in (v as any)) existing[k] += (v as any).increment;
      else existing[k] = v;
    }
    return existing;
  }
}

function makeService() {
  const table = new FakeTrialTable();
  const prisma: any = { trialUsage: table };
  const crypto = new CryptoService('a'.repeat(64));
  const svc = new TrialService(prisma as any, crypto);
  return { svc, table };
}

const sig = (over: Partial<TrialSignals> = {}): TrialSignals => ({
  fingerprint: 'fp-1',
  userAgent: 'Mozilla/5.0',
  timezone: 'Europe/London',
  language: 'en-GB',
  platform: 'MacIntel',
  ...over,
});

describe('TrialService', () => {
  describe('deviceId hashing', () => {
    it('is deterministic for identical signals', () => {
      const { svc } = makeService();
      expect(svc.deviceId(sig())).toBe(svc.deviceId(sig()));
    });
    it('changes when any signal changes', () => {
      const { svc } = makeService();
      const base = svc.deviceId(sig());
      expect(svc.deviceId(sig({ platform: 'Win32' }))).not.toBe(base);
      expect(svc.deviceId(sig({ fingerprint: 'fp-2' }))).not.toBe(base);
    });
    it('hash() output is not the raw input (irreversible)', () => {
      const { svc } = makeService();
      expect(svc.hash('1.2.3.4')).not.toBe('1.2.3.4');
      expect(svc.hash('1.2.3.4')).toMatch(/^[0-9a-f]{64}$/);
    });
    it('hash() tolerates null/undefined input', () => {
      const { svc } = makeService();
      expect(svc.hash(undefined as any)).toMatch(/^[0-9a-f]{64}$/);
      expect(svc.hash(undefined as any)).toBe(svc.hash(''));
    });
    it('deviceId tolerates missing signal fields', () => {
      const { svc } = makeService();
      const partial = { fingerprint: 'fp', userAgent: undefined, timezone: undefined, language: undefined, platform: undefined } as any;
      expect(svc.deviceId(partial)).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('budget', () => {
    it('allows verdicts up to the cap then denies with reason "budget"', async () => {
      const { svc, table } = makeService();
      const s = sig();
      const dev = svc.deviceId(s);
      // Fresh visitor: first verdict allowed, projects 2 remaining.
      const first = await svc.evaluate(s, '1.1.1.1', 'verdict');
      expect(first.allowed).toBe(true);
      expect(first.remaining.verdicts).toBe(TRIAL_VERDICT_CAP - 1);

      // Simulate the cap already consumed.
      table.rows.push({ deviceId: dev, fingerprintHash: 'x', ipHash: 'y', uaHash: 'z', verdictCount: TRIAL_VERDICT_CAP, proposalCount: 0 });
      const denied = await svc.evaluate(s, '1.1.1.1', 'verdict');
      expect(denied.allowed).toBe(false);
      expect(denied.reason).toBe('budget');
      expect(denied.remaining.verdicts).toBe(0);
    });

    it('allows one proposal then denies with reason "proposal_used"', async () => {
      const { svc, table } = makeService();
      const s = sig();
      const dev = svc.deviceId(s);
      const first = await svc.evaluate(s, '1.1.1.1', 'proposal');
      expect(first.allowed).toBe(true);
      expect(first.remaining.proposals).toBe(0);

      table.rows.push({ deviceId: dev, fingerprintHash: 'x', ipHash: 'y', uaHash: 'z', verdictCount: 0, proposalCount: TRIAL_PROPOSAL_CAP });
      const denied = await svc.evaluate(s, '1.1.1.1', 'proposal');
      expect(denied.allowed).toBe(false);
      expect(denied.reason).toBe('proposal_used');
    });
  });

  describe('fraud score', () => {
    it('scores a normal ≤5-device office LOW (allowed)', async () => {
      const { svc, table } = makeService();
      const ip = '203.0.113.7';
      const ipHash = svc.hash(ip);
      // 4 distinct colleagues behind one office IP: distinct fingerprints + UAs.
      for (let i = 0; i < 4; i++) {
        const cs = sig({ fingerprint: `office-${i}`, userAgent: `UA-${i}`, platform: `P-${i}` });
        table.rows.push({
          deviceId: svc.deviceId(cs),
          fingerprintHash: svc.hash(cs.fingerprint),
          ipHash,
          uaHash: svc.hash(cs.userAgent),
          verdictCount: 0,
          proposalCount: 0,
        });
      }
      // A 5th colleague (distinct fingerprint) arrives → 5 devices/IP total.
      const fifth = sig({ fingerprint: 'office-5', userAgent: 'UA-5', platform: 'P-5' });
      const res = await svc.evaluate(fifth, ip, 'verdict');
      expect(res.allowed).toBe(true);
      expect(res.reason).toBeUndefined();
    });

    it('denies a fingerprint-spoofer farming trials (>70) with reason "fraud"', async () => {
      const { svc, table } = makeService();
      const ip = '198.51.100.9';
      const ipHash = svc.hash(ip);
      // Same fingerprint + same UA reused across 6 minted "devices" on one IP
      // (platform spoofed each time → distinct deviceId): +50 (fp reuse) +20 (>5
      // devices/IP) +15 (UA reuse) +5 (baseline) = 90 > 70.
      for (let i = 0; i < 6; i++) {
        const cs = sig({ fingerprint: 'farm', userAgent: 'UA-farm', platform: `spoof-${i}` });
        table.rows.push({
          deviceId: svc.deviceId(cs),
          fingerprintHash: svc.hash('farm'),
          ipHash,
          uaHash: svc.hash('UA-farm'),
          verdictCount: 0,
          proposalCount: 0,
        });
      }
      const next = sig({ fingerprint: 'farm', userAgent: 'UA-farm', platform: 'spoof-7' });
      const res = await svc.evaluate(next, ip, 'verdict');
      expect(res.allowed).toBe(false);
      expect(res.reason).toBe('fraud');
    });
  });

  describe('record', () => {
    it('increments the verdict counter and stores HASHES ONLY (no raw values)', async () => {
      const { svc, table } = makeService();
      const s = sig({ fingerprint: 'raw-fp', userAgent: 'raw-ua' });
      const ip = '9.9.9.9';
      await svc.record(s, ip, 'verdict', 120);

      const row = table.rows[0];
      expect(row.verdictCount).toBe(1);
      expect(row.tokenUsed).toBe(120);
      expect(row.trialUsed).toBe(false);
      // Hashes are stored; no raw signal appears anywhere in the persisted row.
      const serialized = JSON.stringify(row);
      expect(serialized).not.toContain('raw-fp');
      expect(serialized).not.toContain('raw-ua');
      expect(serialized).not.toContain(ip);
      expect(row.fingerprintHash).toBe(svc.hash('raw-fp'));
      expect(row.ipHash).toBe(svc.hash(ip));
    });

    it('flips trialUsed once the proposal is used', async () => {
      const { svc, table } = makeService();
      const s = sig();
      const ip = '9.9.9.9';
      await svc.record(s, ip, 'verdict', 10);
      expect(table.rows[0].trialUsed).toBe(false);
      await svc.record(s, ip, 'proposal', 30);
      expect(table.rows[0].proposalCount).toBe(1);
      expect(table.rows[0].trialUsed).toBe(true);
      expect(table.rows[0].tokenUsed).toBe(40);
    });

    it('stores country when provided and clamps non-positive/invalid token counts to 0', async () => {
      const { svc, table } = makeService();
      const s = sig({ country: 'GB' });
      await svc.record(s, '2.2.2.2', 'verdict', -5);
      expect(table.rows[0].country).toBe('GB');
      expect(table.rows[0].tokenUsed).toBe(0);
      // A NaN token count is also clamped to 0 (best-effort bookkeeping).
      await svc.record(s, '2.2.2.2', 'verdict', Number.NaN);
      expect(table.rows[0].tokenUsed).toBe(0);
    });

    it('never throws on a DB error (best-effort)', async () => {
      const crypto = new CryptoService('a'.repeat(64));
      const prisma: any = { trialUsage: { findUnique: async () => { throw new Error('db down'); } } };
      const svc = new TrialService(prisma, crypto);
      await expect(svc.record(sig(), '1.1.1.1', 'verdict', 5)).resolves.toBeUndefined();
    });
  });
});
