import { AdminController } from '../src/admin/admin.controller';

// Unit-only: drive AdminController with fake AdminService + SuperAdminService.

describe('AdminController', () => {
  const makeReq = (id: string) => ({ superAdmin: { id } }) as any;

  it('login delegates to SuperAdminService.login(email, password, totpCode)', () => {
    const superAdmin: any = { login: jest.fn().mockReturnValue({ token: 't' }) };
    const ctrl = new AdminController({} as any, superAdmin);
    const out = ctrl.login({ email: 'a@b.co', password: 'pw', totpCode: '123456' } as any);
    expect(superAdmin.login).toHaveBeenCalledWith('a@b.co', 'pw', '123456');
    expect(out).toEqual({ token: 't' });
  });

  it('enrollMfa delegates with the super-admin id from the request', () => {
    const superAdmin: any = { enrollMfa: jest.fn().mockReturnValue({ secret: 's', otpauth: 'uri' }) };
    const ctrl = new AdminController({} as any, superAdmin);
    const out = ctrl.enrollMfa(makeReq('sa1'));
    expect(superAdmin.enrollMfa).toHaveBeenCalledWith('sa1');
    expect(out).toEqual({ secret: 's', otpauth: 'uri' });
  });

  it('confirmMfa delegates with the super-admin id + code', () => {
    const superAdmin: any = { confirmMfa: jest.fn().mockReturnValue({ ok: true }) };
    const ctrl = new AdminController({} as any, superAdmin);
    const out = ctrl.confirmMfa(makeReq('sa2'), { code: '000000' } as any);
    expect(superAdmin.confirmMfa).toHaveBeenCalledWith('sa2', '000000');
    expect(out).toEqual({ ok: true });
  });

  it('setLlm delegates to AdminService.setGlobalLlm(dto)', () => {
    const admin: any = { setGlobalLlm: jest.fn().mockReturnValue({ ok: true }) };
    const ctrl = new AdminController(admin, {} as any);
    const dto = { provider: 'openai', model: 'gpt' } as any;
    const out = ctrl.setLlm(dto);
    expect(admin.setGlobalLlm).toHaveBeenCalledWith(dto);
    expect(out).toEqual({ ok: true });
  });

  it('status delegates to AdminService.getGlobalLlmStatus()', () => {
    const admin: any = { getGlobalLlmStatus: jest.fn().mockReturnValue({ configured: true }) };
    const ctrl = new AdminController(admin, {} as any);
    const out = ctrl.status();
    expect(admin.getGlobalLlmStatus).toHaveBeenCalled();
    expect(out).toEqual({ configured: true });
  });

  it('orgs delegates to AdminService.listOrgs()', () => {
    const admin: any = { listOrgs: jest.fn().mockReturnValue([{ id: 'o1' }]) };
    const ctrl = new AdminController(admin, {} as any);
    const out = ctrl.orgs();
    expect(admin.listOrgs).toHaveBeenCalled();
    expect(out).toEqual([{ id: 'o1' }]);
  });
});
