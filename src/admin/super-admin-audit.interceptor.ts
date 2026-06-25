import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { SuperAdminService } from './super-admin.service';

// H3: records every successful authenticated /admin call. Logs method + path + who
// + ip — never the request body, which can contain secrets (e.g. an LLM API key).
@Injectable()
export class SuperAdminAuditInterceptor implements NestInterceptor {
  constructor(private superAdmin: SuperAdminService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    const req = ctx.switchToHttp().getRequest();
    // Write the audit row before the response completes, so the trail is durable
    // and never lost to a fire-and-forget race. Volume here is low (admin surface).
    return next.handle().pipe(
      mergeMap(async (value) => {
        const admin = req.superAdmin;
        if (admin?.id) {
          const action = `${req.method} ${req.route?.path ?? req.originalUrl ?? req.url}`;
          const ip = req.ip ?? req.socket?.remoteAddress;
          await this.superAdmin.audit(admin.id, action, ip);
        }
        return value;
      }),
    );
  }
}
