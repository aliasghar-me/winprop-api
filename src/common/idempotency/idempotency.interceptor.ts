import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, from, of } from 'rxjs';
import { concatMap, catchError } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';
import { AppException } from '../errors/app-exception';

const MUTATIONS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Opt-in idempotency (T2.4): when a mutating request carries an `Idempotency-Key`
 * header, the key is claimed before the handler runs and the response is cached, so
 * a client retry replays the original result instead of re-executing (e.g. no
 * double quota charge on a retried generation). Scoped per org.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private prisma: PrismaService) {}

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const req = ctx.switchToHttp().getRequest();
    const res = ctx.switchToHttp().getResponse();
    const key = req.headers['idempotency-key'];
    const orgId = req.user?.orgId;
    if (!key || typeof key !== 'string' || !orgId || !MUTATIONS.has(req.method)) {
      return next.handle();
    }

    // Claim the key. A unique (orgId, key) makes the claim atomic across concurrent retries.
    try {
      await this.prisma.idempotencyKey.create({ data: { orgId, key, status: 'pending' } });
    } catch (e: unknown) {
      if ((e as { code?: string })?.code !== 'P2002') throw e;
      const row = await this.prisma.idempotencyKey.findUnique({ where: { orgId_key: { orgId, key } } });
      if (row?.status === 'completed') {
        res.status(row.statusCode ?? 200);
        return of(row.responseJson);
      }
      // First request still in flight — tell the client to retry shortly.
      throw new AppException(409, 'IDEMPOTENCY_CONFLICT', 'errors.idempotencyConflict');
    }

    return next.handle().pipe(
      concatMap(async (data) => {
        await this.prisma.idempotencyKey.update({
          where: { orgId_key: { orgId, key } },
          data: { status: 'completed', statusCode: res.statusCode ?? 200, responseJson: (data ?? {}) as object },
        });
        return data;
      }),
      // On failure, release the claim so a retry can proceed.
      catchError((err) =>
        from(
          this.prisma.idempotencyKey
            .delete({ where: { orgId_key: { orgId, key } } })
            .catch(() => undefined)
            .then(() => { throw err; }),
        ),
      ),
    );
  }
}
