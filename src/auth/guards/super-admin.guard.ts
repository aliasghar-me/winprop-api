import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppException } from '../../common/errors/app-exception';

@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const email = ctx.switchToHttp().getRequest().headers['x-super-admin'];
    if (!email) throw new AppException(403, 'FORBIDDEN', 'errors.superAdminOnly');
    const found = await this.prisma.superAdmin.findUnique({ where: { email: String(email) } });
    if (!found) throw new AppException(403, 'FORBIDDEN', 'errors.superAdminOnly');
    return true;
  }
}
