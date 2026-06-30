import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { AppException } from '../common/errors/app-exception';

const TOKEN_TTL_MS = 24 * 3600 * 1000;
const hash = (raw: string) => createHash('sha256').update(raw).digest('hex');
const verifyBaseUrl = () => `${process.env.WEB_ORIGIN?.split(',')[0] ?? 'https://app.winprop.ai'}/verify-email`;

@Injectable()
export class EmailVerificationService {
  constructor(private prisma: PrismaService, private mail: MailService, private crypto: CryptoService) {}

  // Whether unverified accounts are blocked from paid LLM actions. On by default;
  // a disable switch is honoured only outside production (mirrors THROTTLE_DISABLED).
  static required(): boolean {
    return !(process.env.EMAIL_VERIFICATION_REQUIRED === 'false' && process.env.NODE_ENV !== 'production');
  }

  // Issue a fresh single-use token and email the verification link. Any prior
  // unconsumed tokens for the user are invalidated so only the newest link works.
  async issueForUser(userId: string, email: string): Promise<void> {
    const raw = randomBytes(32).toString('base64url');
    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.updateMany({
        where: { userId, consumedAt: null },
        data: { consumedAt: new Date() },
      }),
      this.prisma.emailVerificationToken.create({
        data: { userId, tokenHash: hash(raw), expiresAt: new Date(Date.now() + TOKEN_TTL_MS) },
      }),
    ]);
    await this.mail.sendVerificationEmail(email, `${verifyBaseUrl()}?token=${raw}`);
  }

  // Consume a token and mark the user verified. Idempotent-ish: a valid token
  // flips the user; an unknown/expired/used token is a generic 400.
  async verify(rawToken: string): Promise<{ ok: true }> {
    if (!rawToken) throw new AppException(400, 'INVALID_TOKEN', 'errors.invalidVerificationToken');
    const token = await this.prisma.emailVerificationToken.findUnique({ where: { tokenHash: hash(rawToken) } });
    if (!token || token.consumedAt || token.expiresAt.getTime() < Date.now())
      throw new AppException(400, 'INVALID_TOKEN', 'errors.invalidVerificationToken');
    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.update({ where: { id: token.id }, data: { consumedAt: new Date() } }),
      this.prisma.user.update({ where: { id: token.userId }, data: { emailVerifiedAt: new Date() } }),
    ]);
    return { ok: true };
  }

  // Resend for the authenticated user (no-op response shape if already verified).
  async resend(userId: string): Promise<{ ok: true }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user && !user.emailVerifiedAt) await this.issueForUser(user.id, this.crypto.decryptSafe(user.email));
    return { ok: true };
  }
}
