import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { SignupDto } from './dto/signup.dto';
import { AppException } from '../common/errors/app-exception';

const REFRESH_TTL_MS = 7 * 24 * 3600 * 1000;

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
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  async signup(dto: SignupDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new AppException(400, 'VALIDATION', 'errors.emailInUse');
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const defs = PROFESSION_DEFAULTS[dto.profession];

    const { user, org, membership } = await this.prisma.$transaction(async (tx: any) => {
      const user = await tx.user.create({ data: { email: dto.email, passwordHash, name: dto.name } });
      const org = await tx.org.create({ data: { name: dto.agencyName, profession: dto.profession } });
      const membership = await tx.membership.create({ data: { userId: user.id, orgId: org.id, role: 'owner' } });
      await tx.profile.create({ data: { orgId: org.id, agencyName: dto.agencyName, services: defs.services, skills: defs.skills } });
      return { user, org, membership };
    });
    return this.issueTokens(user.id, org.id, membership.role);
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email }, include: { memberships: true } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash)))
      throw new AppException(401, 'UNAUTHORIZED', 'errors.invalidCredentials');
    const m = user.memberships[0];
    return this.issueTokens(user.id, m.orgId, m.role);
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
    try { payload = this.jwt.verify(refreshToken); } catch { throw new AppException(401, 'UNAUTHORIZED', 'errors.invalidRefreshToken'); }
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

    // Rotate: issue the new pair first, then revoke the old jti pointing at the new one.
    const tokens = await this.issueTokens(payload.sub, payload.orgId, membership.role); // CURRENT role
    const newJti = (this.jwt.decode(tokens.refreshToken) as any)?.jti;
    await this.prisma.refreshToken.update({
      where: { jti: payload.jti },
      data: { revokedAt: new Date(), replacedById: newJti },
    });
    return tokens;
  }

  // Logout: revoke the presented refresh token (no-op if already gone/invalid).
  async logout(refreshToken?: string) {
    if (!refreshToken) return { ok: true };
    let payload: any;
    try { payload = this.jwt.verify(refreshToken); } catch { return { ok: true }; }
    if (payload?.jti) {
      await this.prisma.refreshToken
        .updateMany({ where: { jti: payload.jti, revokedAt: null }, data: { revokedAt: new Date() } })
        .catch(() => undefined);
    }
    return { ok: true };
  }

  private async revokeAllForUser(userId: string) {
    await this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}
