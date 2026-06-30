import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppException } from '../../common/errors/app-exception';
import { EmailVerificationService } from '../email-verification.service';

/**
 * Blocks paid LLM actions (generate / analyze / regenerate) for accounts that
 * haven't verified their email — the main lever against mass-signup LLM-cost
 * abuse (security #1). Runs after JwtAuthGuard, so `req.user` is present.
 */
@Injectable()
export class EmailVerifiedGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (!EmailVerificationService.required()) return true;
    const req = ctx.switchToHttp().getRequest();
    const user = await this.prisma.user.findUnique({ where: { id: req.user.userId } });
    if (!user?.emailVerifiedAt) throw new AppException(403, 'EMAIL_NOT_VERIFIED', 'errors.emailNotVerified');
    return true;
  }
}
