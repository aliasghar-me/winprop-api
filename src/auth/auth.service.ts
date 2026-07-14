import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { SignupDto } from './dto/signup.dto';
import { AppException } from '../common/errors/app-exception';
import { EmailVerificationService } from './email-verification.service';
import type { Profession } from '@prisma/client';

const REFRESH_TTL_MS = 7 * 24 * 3600 * 1000;
const BCRYPT_COST = 12;
const MAX_FAILED_LOGINS = 10;
const LOCKOUT_MS = 15 * 60 * 1000;
// Constant hash to compare against when the user doesn't exist — equalizes login
// timing so an attacker can't distinguish "no such email" from "wrong password".
const DUMMY_HASH = bcrypt.hashSync('winprop-timing-equalizer', BCRYPT_COST);

const PROFESSION_DEFAULTS: Record<string, { services: string[]; skills: string[] }> = {
  developer: { services: ['SaaS Platforms', 'Backend Architecture'], skills: ['Next.js', 'NestJS', 'PostgreSQL'] },
  designer: { services: ['Brand identity', 'UI/UX design'], skills: ['Figma', 'Framer'] },
  writer: { services: ['Content strategy', 'Copywriting'], skills: ['Long-form', 'SEO'] },
  sales: { services: ['Sales consulting', 'GTM strategy'], skills: ['SaaS', 'Outbound'] },
  marketer: { services: ['Growth marketing', 'Campaign strategy'], skills: ['Paid social', 'Email'] },
  consultant: { services: ['Advisory', 'Diagnostics'], skills: ['Strategy', 'Operations'] },
  video: { services: ['Brand films', 'Motion graphics'], skills: ['Direction', 'Editing'] },
};

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private emailVerification: EmailVerificationService,
    private crypto: CryptoService,
  ) {}

  async signup(dto: SignupDto) {
    const existing = await this.prisma.user.findUnique({ where: { emailHash: this.crypto.hmac(dto.email) } });
    if (existing) throw new AppException(400, 'VALIDATION', 'errors.emailInUse');

    const { user, org, membership } = await this.provisionAccount({
      email: dto.email,
      password: dto.password,
      name: dto.name,
      agencyName: dto.agencyName,
      profession: dto.profession,
    });
    // Send the verification email (auto-login still applies; generation is gated
    // until verified). Non-fatal so a mail hiccup never blocks signup.
    await this.emailVerification.issueForUser(user.id, dto.email).catch(() => undefined);
    return this.issueTokens(user.id, org.id, membership.role);
  }

  // Reusable "create a brand-new tenant" primitive: User + owner Org + Membership
  // (+ default Profile). Shared by signup (real password up-front) and the card-first
  // trial (no password yet — auto-provisioned, passwordSetAt stays null so onboarding
  // can prompt for one). Does NOT check for a duplicate email or issue tokens — the
  // caller owns those decisions. email + name are stored encrypted; emailHash is the
  // deterministic blind index used for lookups.
  async provisionAccount(input: { email: string; password?: string; name?: string; agencyName?: string; profession?: Profession }) {
    const profession: Profession = input.profession ?? 'developer';
    const agencyName = input.agencyName ?? '';
    const name = input.name ?? '';
    // A real password sets passwordSetAt now; a trial account gets a random,
    // effectively-unusable password (they set the real one during onboarding).
    const hasPassword = typeof input.password === 'string' && input.password.length > 0;
    const rawPassword = hasPassword ? (input.password as string) : randomUUID() + randomUUID();
    const passwordHash = await bcrypt.hash(rawPassword, BCRYPT_COST);
    const defs = PROFESSION_DEFAULTS[profession] ?? PROFESSION_DEFAULTS.developer;

    return this.prisma.$transaction(async (tx: any) => {
      const user = await tx.user.create({
        data: {
          email: this.crypto.encrypt(input.email),
          emailHash: this.crypto.hmac(input.email),
          passwordHash,
          passwordSetAt: hasPassword ? new Date() : null,
          name: this.crypto.encrypt(name),
        },
      });
      const org = await tx.org.create({ data: { name: agencyName, profession } });
      const membership = await tx.membership.create({ data: { userId: user.id, orgId: org.id, role: 'owner' } });
      await tx.profile.create({ data: { orgId: org.id, agencyName, services: defs.services, skills: defs.skills } });
      return { user, org, membership };
    });
  }

  // Onboarding "set your password" for an auto-provisioned (trial) user so they can
  // log back in later. Overwrites the random provisioning hash and stamps passwordSetAt.
  async setPassword(userId: string, password: string) {
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash, passwordSetAt: new Date() } });
    return { ok: true };
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { emailHash: this.crypto.hmac(email) }, include: { memberships: true } });
    // Lockout (after MAX_FAILED_LOGINS) — neutral 401 so it doesn't reveal the email exists.
    if (user?.lockedUntil && user.lockedUntil.getTime() > Date.now())
      throw new AppException(401, 'UNAUTHORIZED', 'errors.invalidCredentials');
    // Always run a bcrypt compare (dummy when no user) to equalize timing — anti-enumeration.
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) {
      if (user) await this.recordFailedLogin(user.id, user.failedLoginCount);
      throw new AppException(401, 'UNAUTHORIZED', 'errors.invalidCredentials');
    }
    if (user.failedLoginCount > 0 || user.lockedUntil)
      await this.prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
    const m = user.memberships[0];
    return this.issueTokens(user.id, m.orgId, m.role);
  }

  private async recordFailedLogin(userId: string, current: number) {
    const next = current + 1;
    const data = next >= MAX_FAILED_LOGINS
      ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCKOUT_MS) }
      : { failedLoginCount: next };
    await this.prisma.user.update({ where: { id: userId }, data }).catch(() => undefined);
  }

  // Mints an access token and a refresh token whose `jti` is persisted to the
  // RefreshToken store (H5), so the refresh token can be hard-revoked server-side.
  async issueTokens(userId: string, orgId: string, role: string) {
    const jti = randomUUID();
    const accessToken = this.jwt.sign({ sub: userId, orgId, role }, { expiresIn: '10m' });
    const refreshToken = this.jwt.sign({ sub: userId, orgId, role, typ: 'refresh', jti }, { expiresIn: '7d' });
    await this.prisma.refreshToken.create({
      data: { jti, userId, expiresAt: new Date(Date.now() + REFRESH_TTL_MS) },
    });
    return { accessToken, refreshToken };
  }

  async refresh(refreshToken: string) {
    let payload: any;
    try { payload = this.jwt.verify(refreshToken, { algorithms: ["HS256"] }); } catch { throw new AppException(401, 'UNAUTHORIZED', 'errors.invalidRefreshToken'); }
    if (payload.typ !== 'refresh' || !payload.jti) throw new AppException(401, 'UNAUTHORIZED', 'errors.invalidRefreshToken');

    const stored = await this.prisma.refreshToken.findUnique({ where: { jti: payload.jti } });
    if (!stored || stored.userId !== payload.sub) throw new AppException(401, 'UNAUTHORIZED', 'errors.invalidRefreshToken');

    // Reuse detection: a revoked jti being presented again means the token was
    // captured and replayed. Revoke the user's entire chain and refuse.
    if (stored.revokedAt) {
      await this.revokeAllForUser(payload.sub);
      throw new AppException(401, 'UNAUTHORIZED', 'errors.invalidRefreshToken');
    }
    if (stored.expiresAt.getTime() < Date.now()) throw new AppException(401, 'UNAUTHORIZED', 'errors.invalidRefreshToken');

    const membership = await this.prisma.membership.findUnique({
      where: { userId_orgId: { userId: payload.sub, orgId: payload.orgId } },
    });
    if (!membership) throw new AppException(401, 'UNAUTHORIZED', 'errors.accessRevoked');

    // Atomically CLAIM the old jti (single-winner). If two requests race with the same
    // token, only one flips revokedAt null->now; the loser (count 0) is treated as reuse.
    const claim = await this.prisma.refreshToken.updateMany({
      where: { jti: payload.jti, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claim.count === 0) {
      await this.revokeAllForUser(payload.sub);
      throw new AppException(401, 'UNAUTHORIZED', 'errors.invalidRefreshToken');
    }
    const tokens = await this.issueTokens(payload.sub, payload.orgId, membership.role); // CURRENT role
    const newJti = (this.jwt.decode(tokens.refreshToken) as any)?.jti;
    await this.prisma.refreshToken.update({ where: { jti: payload.jti }, data: { replacedById: newJti } });
    return tokens;
  }

  // Revoke every active refresh token for a user ("logout everywhere"). Public for /auth/logout-all.
  async revokeAllForUser(userId: string) {
    await this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    return { ok: true };
  }

  // Logout: revoke the presented refresh token (no-op if already gone/invalid).
  async logout(refreshToken?: string) {
    if (!refreshToken) return { ok: true };
    let payload: any;
    try { payload = this.jwt.verify(refreshToken, { algorithms: ["HS256"] }); } catch { return { ok: true }; }
    if (payload?.jti) {
      await this.prisma.refreshToken
        .updateMany({ where: { jti: payload.jti, revokedAt: null }, data: { revokedAt: new Date() } })
        .catch(() => undefined);
    }
    return { ok: true };
  }
}
