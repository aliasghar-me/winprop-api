import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { setTenantOrgId } from './tenant-context';

// Populates the request's tenant store with the authenticated org id. Runs AFTER
// JwtAuthGuard (so req.user exists). Attach to tenant-scoped controllers only.
@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    if (req.user?.orgId) setTenantOrgId(req.user.orgId);
    return true;
  }
}
