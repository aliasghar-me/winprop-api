import { lastValueFrom, of } from 'rxjs';
import { SuperAdminAuditInterceptor } from '../src/admin/super-admin-audit.interceptor';

// Unit-only: drive intercept() with a fake ExecutionContext + CallHandler and a
// fake SuperAdminService, asserting the audit row is written on the intercepted call.

const ctxFor = (req: any): any => ({
  switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
});
const handlerOf = (value: any) => ({ handle: jest.fn(() => of(value)) });

describe('SuperAdminAuditInterceptor (unit)', () => {
  it('records an audit row using route.path and req.ip, then returns the value', async () => {
    const audit = jest.fn().mockResolvedValue(undefined);
    const interceptor = new SuperAdminAuditInterceptor({ audit } as any);
    const req = { superAdmin: { id: 'sa1' }, method: 'POST', route: { path: '/admin/llm' }, ip: '1.2.3.4' };
    const out = interceptor.intercept(ctxFor(req), handlerOf('RESULT') as any);
    expect(await lastValueFrom(out)).toBe('RESULT');
    expect(audit).toHaveBeenCalledWith('sa1', 'POST /admin/llm', '1.2.3.4');
  });

  it('falls back to originalUrl and socket.remoteAddress when route/ip are absent', async () => {
    const audit = jest.fn().mockResolvedValue(undefined);
    const interceptor = new SuperAdminAuditInterceptor({ audit } as any);
    const req = { superAdmin: { id: 'sa1' }, method: 'GET', originalUrl: '/admin/orgs', socket: { remoteAddress: '9.9.9.9' } };
    const out = interceptor.intercept(ctxFor(req), handlerOf('R') as any);
    await lastValueFrom(out);
    expect(audit).toHaveBeenCalledWith('sa1', 'GET /admin/orgs', '9.9.9.9');
  });

  it('falls back to req.url when neither route nor originalUrl exist', async () => {
    const audit = jest.fn().mockResolvedValue(undefined);
    const interceptor = new SuperAdminAuditInterceptor({ audit } as any);
    const req = { superAdmin: { id: 'sa1' }, method: 'DELETE', url: '/admin/x' };
    const out = interceptor.intercept(ctxFor(req), handlerOf('R') as any);
    await lastValueFrom(out);
    expect(audit).toHaveBeenCalledWith('sa1', 'DELETE /admin/x', undefined);
  });

  it('does not audit when there is no authenticated super admin', async () => {
    const audit = jest.fn();
    const interceptor = new SuperAdminAuditInterceptor({ audit } as any);
    const out = interceptor.intercept(ctxFor({ method: 'GET', url: '/admin/x' }), handlerOf('R') as any);
    expect(await lastValueFrom(out)).toBe('R');
    expect(audit).not.toHaveBeenCalled();
  });
});
