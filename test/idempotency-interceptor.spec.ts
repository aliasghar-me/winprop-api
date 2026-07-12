import { lastValueFrom, of, throwError } from 'rxjs';
import { IdempotencyInterceptor } from '../src/common/idempotency/idempotency.interceptor';

// Unit-only: drive intercept() directly with a fake ExecutionContext + CallHandler.
// Fake Prisma.idempotencyKey covers the claim/replay/conflict branches.

const ctxFor = (req: any, res: any = { status: jest.fn(), statusCode: 201 }): any => ({
  switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
});
const handlerOf = (value: any) => ({ handle: jest.fn(() => of(value)) });

const makePrisma = () => ({ idempotencyKey: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), delete: jest.fn() } });

const baseReq = (over: any = {}) => ({ method: 'POST', headers: { 'idempotency-key': 'k1' }, user: { orgId: 'o1' }, ...over });

describe('IdempotencyInterceptor (unit)', () => {
  it('passes through when no idempotency key header is present', async () => {
    const prisma: any = makePrisma();
    const next = handlerOf('R');
    const out = await new IdempotencyInterceptor(prisma).intercept(ctxFor(baseReq({ headers: {} })), next as any);
    expect(await lastValueFrom(out)).toBe('R');
    expect(next.handle).toHaveBeenCalled();
    expect(prisma.idempotencyKey.create).not.toHaveBeenCalled();
  });

  it('passes through for a non-mutating method even with a key', async () => {
    const prisma: any = makePrisma();
    const next = handlerOf('R');
    const out = await new IdempotencyInterceptor(prisma).intercept(ctxFor(baseReq({ method: 'GET' })), next as any);
    expect(await lastValueFrom(out)).toBe('R');
    expect(prisma.idempotencyKey.create).not.toHaveBeenCalled();
  });

  it('passes through when there is no orgId', async () => {
    const prisma: any = makePrisma();
    const next = handlerOf('R');
    const out = await new IdempotencyInterceptor(prisma).intercept(ctxFor(baseReq({ user: undefined })), next as any);
    expect(await lastValueFrom(out)).toBe('R');
    expect(prisma.idempotencyKey.create).not.toHaveBeenCalled();
  });

  it('claims the key, runs the handler, and marks the row completed', async () => {
    const prisma: any = makePrisma();
    prisma.idempotencyKey.create.mockResolvedValue({});
    prisma.idempotencyKey.update.mockResolvedValue({});
    const res = { status: jest.fn(), statusCode: 201 };
    const next = handlerOf({ ok: 1 });
    const out = await new IdempotencyInterceptor(prisma).intercept(ctxFor(baseReq(), res), next as any);
    const val = await lastValueFrom(out);
    expect(val).toEqual({ ok: 1 });
    expect(prisma.idempotencyKey.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'completed', statusCode: 201, responseJson: { ok: 1 } }),
    }));
  });

  it('defaults responseJson to {} when the handler emits null/undefined', async () => {
    const prisma: any = makePrisma();
    prisma.idempotencyKey.create.mockResolvedValue({});
    prisma.idempotencyKey.update.mockResolvedValue({});
    const res = { status: jest.fn(), statusCode: undefined };
    const next = handlerOf(undefined);
    const out = await new IdempotencyInterceptor(prisma).intercept(ctxFor(baseReq(), res), next as any);
    await lastValueFrom(out);
    expect(prisma.idempotencyKey.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ statusCode: 200, responseJson: {} }),
    }));
  });

  it('replays the cached response when the key was already completed', async () => {
    const prisma: any = makePrisma();
    prisma.idempotencyKey.create.mockRejectedValue({ code: 'P2002' });
    prisma.idempotencyKey.findUnique.mockResolvedValue({ status: 'completed', statusCode: 200, responseJson: { cached: true } });
    const res = { status: jest.fn(), statusCode: 201 };
    const next = handlerOf('SHOULD_NOT_RUN');
    const out = await new IdempotencyInterceptor(prisma).intercept(ctxFor(baseReq(), res), next as any);
    expect(await lastValueFrom(out)).toEqual({ cached: true });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(next.handle).not.toHaveBeenCalled();
  });

  it('replays with default 200 status when the completed row has no statusCode', async () => {
    const prisma: any = makePrisma();
    prisma.idempotencyKey.create.mockRejectedValue({ code: 'P2002' });
    prisma.idempotencyKey.findUnique.mockResolvedValue({ status: 'completed', statusCode: null, responseJson: { c: 1 } });
    const res = { status: jest.fn(), statusCode: 201 };
    const out = await new IdempotencyInterceptor(prisma).intercept(ctxFor(baseReq(), res), handlerOf('x') as any);
    await lastValueFrom(out);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('throws IDEMPOTENCY_CONFLICT when the first request is still in flight', async () => {
    const prisma: any = makePrisma();
    prisma.idempotencyKey.create.mockRejectedValue({ code: 'P2002' });
    prisma.idempotencyKey.findUnique.mockResolvedValue({ status: 'pending' });
    await expect(new IdempotencyInterceptor(prisma).intercept(ctxFor(baseReq()), handlerOf('x') as any))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('rethrows a non-P2002 create error', async () => {
    const prisma: any = makePrisma();
    prisma.idempotencyKey.create.mockRejectedValue(new Error('db down'));
    await expect(new IdempotencyInterceptor(prisma).intercept(ctxFor(baseReq()), handlerOf('x') as any))
      .rejects.toThrow('db down');
  });

  it('releases the claim and rethrows when the handler errors', async () => {
    const prisma: any = makePrisma();
    prisma.idempotencyKey.create.mockResolvedValue({});
    prisma.idempotencyKey.delete.mockResolvedValue({});
    const failing = { handle: jest.fn(() => throwError(() => new Error('handler failed'))) };
    const out = await new IdempotencyInterceptor(prisma).intercept(ctxFor(baseReq()), failing as any);
    await expect(lastValueFrom(out)).rejects.toThrow('handler failed');
    expect(prisma.idempotencyKey.delete).toHaveBeenCalled();
  });

  it('still rethrows the handler error even if releasing the claim fails', async () => {
    const prisma: any = makePrisma();
    prisma.idempotencyKey.create.mockResolvedValue({});
    prisma.idempotencyKey.delete.mockRejectedValue(new Error('delete failed'));
    const failing = { handle: jest.fn(() => throwError(() => new Error('handler failed'))) };
    const out = await new IdempotencyInterceptor(prisma).intercept(ctxFor(baseReq()), failing as any);
    await expect(lastValueFrom(out)).rejects.toThrow('handler failed');
  });
});
