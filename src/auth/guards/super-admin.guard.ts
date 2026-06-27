import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppException } from '../../common/errors/app-exception';

// H3: verifies a scope-stamped super-admin JWT (from POST /admin/login) instead of
// trusting an `x-super-admin` header. Attaches the resolved admin to the request so
// the audit interceptor can record who acted.
@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(private jwt: JwtService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();

    // Optional IP allow-list for the privileged surface (security #8).
    const allow = process.env.SUPER_ADMIN_IPS?.split(',').map((s) => s.trim()).filter(Boolean);
    if (allow && allow.length && !allow.includes(req.ip)) throw new AppException(403, 'FORBIDDEN', 'errors.superAdminOnly');

    const header: string = req.headers['authorization'] ?? '';
    const [type, token] = header.split(' ');
    if (type !== 'Bearer' || !token) throw new AppException(403, 'FORBIDDEN', 'errors.superAdminOnly');

    let payload: any;
    try {
      payload = this.jwt.verify(token, { algorithms: ['HS256'], secret: process.env.SUPER_ADMIN_JWT_SECRET || process.env.JWT_SECRET });
    } catch {
      throw new AppException(403, 'FORBIDDEN', 'errors.superAdminOnly');
    }
    if (payload?.scope !== 'super-admin' || !payload?.sub)
      throw new AppException(403, 'FORBIDDEN', 'errors.superAdminOnly');

    req.superAdmin = { id: payload.sub, email: payload.email };
    return true;
  }
}
