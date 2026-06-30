import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { runWithTenantStore } from './tenant-context';

// Enters a fresh tenant store that wraps the whole request, so TenantGuard can
// fill orgId and the Prisma extension can read it anywhere downstream.
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  use(_req: Request, _res: Response, next: NextFunction) {
    runWithTenantStore(() => next());
  }
}
