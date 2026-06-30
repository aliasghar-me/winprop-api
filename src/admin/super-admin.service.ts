import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { AppException } from '../common/errors/app-exception';
import { generateBase32Secret, otpauthUrl, verifyTotp } from './totp.util';

// H3: real super-admin auth. Replaces the trusted `x-super-admin` header with a
// password login that issues a short-lived, scope-stamped JWT, plus an audit log.
@Injectable()
export class SuperAdminService {
  constructor(private prisma: PrismaService, private jwt: JwtService, private crypto: CryptoService) {}

  async login(email: string, password: string, totpCode?: string) {
    const admin = await this.prisma.superAdmin.findUnique({ where: { email } });
    // Same neutral 401 whether the row, the password hash, or the password is wrong.
    if (!admin || !admin.passwordHash || !(await bcrypt.compare(password, admin.passwordHash)))
      throw new AppException(401, 'UNAUTHORIZED', 'errors.invalidCredentials');
    // Second factor (security #8): once enrolled, a valid TOTP code is mandatory.
    if (admin.totpEnabledAt && admin.totpSecret) {
      if (!totpCode) throw new AppException(401, 'MFA_REQUIRED', 'errors.mfaRequired');
      if (!verifyTotp(totpCode, this.crypto.decrypt(admin.totpSecret)))
        throw new AppException(401, 'UNAUTHORIZED', 'errors.invalidCredentials');
    }
    return { token: this.signToken(admin.id, admin.email) };
  }

  private signToken(sub: string, email: string): string {
    return this.jwt.sign(
      { sub, email, scope: 'super-admin' },
      {
        expiresIn: (process.env.SUPER_ADMIN_TOKEN_TTL || '1h') as `${number}h`,
        // Separate signing secret for the privileged scope when provided, so a leak
        // of the user JWT secret can't mint super-admin tokens (security #8).
        secret: process.env.SUPER_ADMIN_JWT_SECRET || process.env.JWT_SECRET,
        algorithm: 'HS256',
      },
    );
  }

  // Begin TOTP enrollment: store an encrypted (pending) secret and return the
  // otpauth URI for the authenticator app. Not enforced until confirmMfa succeeds.
  async enrollMfa(adminId: string) {
    const admin = await this.prisma.superAdmin.findUnique({ where: { id: adminId } });
    if (!admin) throw new AppException(404, 'NOT_FOUND', 'errors.superAdminOnly');
    if (admin.totpEnabledAt) throw new AppException(400, 'VALIDATION', 'errors.mfaAlreadyEnabled');
    const secret = generateBase32Secret();
    await this.prisma.superAdmin.update({ where: { id: adminId }, data: { totpSecret: this.crypto.encrypt(secret) } });
    return { secret, otpauthUrl: otpauthUrl(secret, admin.email) };
  }

  // Confirm enrollment by proving possession of a current code, then enable MFA.
  async confirmMfa(adminId: string, code: string) {
    const admin = await this.prisma.superAdmin.findUnique({ where: { id: adminId } });
    if (!admin?.totpSecret) throw new AppException(400, 'VALIDATION', 'errors.mfaNotEnrolled');
    if (!verifyTotp(code, this.crypto.decrypt(admin.totpSecret)))
      throw new AppException(400, 'MFA_INVALID', 'errors.mfaInvalid');
    await this.prisma.superAdmin.update({ where: { id: adminId }, data: { totpEnabledAt: new Date() } });
    return { ok: true };
  }

  async audit(superAdminId: string, action: string, ip?: string) {
    await this.prisma.superAdminAuditLog
      .create({ data: { superAdminId, action, ip: ip?.slice(0, 64) } })
      .catch(() => undefined); // auditing must never break the action it records
  }
}
