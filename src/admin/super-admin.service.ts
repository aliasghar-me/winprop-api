import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/errors/app-exception';

// H3: real super-admin auth. Replaces the trusted `x-super-admin` header with a
// password login that issues a short-lived, scope-stamped JWT, plus an audit log.
@Injectable()
export class SuperAdminService {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  async login(email: string, password: string) {
    const admin = await this.prisma.superAdmin.findUnique({ where: { email } });
    // Same neutral 401 whether the row, the password hash, or the password is wrong.
    if (!admin || !admin.passwordHash || !(await bcrypt.compare(password, admin.passwordHash)))
      throw new AppException(401, 'UNAUTHORIZED', 'errors.invalidCredentials');
    const token = this.jwt.sign(
      { sub: admin.id, email: admin.email, scope: 'super-admin' },
      {
        expiresIn: (process.env.SUPER_ADMIN_TOKEN_TTL || '1h') as `${number}h`,
        // Separate signing secret for the privileged scope when provided, so a leak
        // of the user JWT secret can't mint super-admin tokens (security #8).
        secret: process.env.SUPER_ADMIN_JWT_SECRET || process.env.JWT_SECRET,
        algorithm: 'HS256',
      },
    );
    return { token };
  }

  async audit(superAdminId: string, action: string, ip?: string) {
    await this.prisma.superAdminAuditLog
      .create({ data: { superAdminId, action, ip: ip?.slice(0, 64) } })
      .catch(() => undefined); // auditing must never break the action it records
  }
}
