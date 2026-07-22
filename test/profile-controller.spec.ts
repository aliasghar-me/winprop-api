import { ProfileController } from '../src/profile/profile.controller';

// Unit-only: instantiate ProfileController with a mocked ProfileService.

function makeService() {
  return {
    get: jest.fn().mockResolvedValue({ id: 'p1' }),
    update: jest.fn().mockResolvedValue({ id: 'p1' }),
  };
}

const user = { orgId: 'org1', userId: 'u1' } as any;

describe('ProfileController', () => {
  let svc: ReturnType<typeof makeService>;
  let ctrl: ProfileController;

  beforeEach(() => {
    svc = makeService();
    ctrl = new ProfileController(svc as any);
  });

  it('get delegates orgId', () => {
    ctrl.get(user);
    expect(svc.get).toHaveBeenCalledWith('org1');
  });

  it('update delegates orgId + dto', () => {
    const dto = { displayName: 'Acme' } as any;
    ctrl.update(user, dto);
    expect(svc.update).toHaveBeenCalledWith('org1', dto);
  });
});
