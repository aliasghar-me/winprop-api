import { JobsController } from '../src/jobs/jobs.controller';

// Unit-only: instantiate JobsController with a mocked JobsService.

function makeService() {
  return {
    create: jest.fn().mockResolvedValue({ id: 'j1' }),
    assess: jest.fn().mockResolvedValue({ job: { id: 'j1' }, analysis: {} }),
    list: jest.fn().mockResolvedValue([{ id: 'j1' }]),
    getOwned: jest.fn().mockResolvedValue({ id: 'j1' }),
    analyze: jest.fn().mockResolvedValue({ objective: 'x' }),
    update: jest.fn().mockResolvedValue({ id: 'j1' }),
  };
}

const user = { orgId: 'org1', userId: 'u1' } as any;
const reservation = { id: 'resv1' };
const req = { quotaReservation: reservation } as any;

describe('JobsController', () => {
  let svc: ReturnType<typeof makeService>;
  let ctrl: JobsController;

  beforeEach(() => {
    svc = makeService();
    ctrl = new JobsController(svc as any);
  });

  it('create delegates the dto', () => {
    const dto = { title: 't' } as any;
    ctrl.create(user, dto);
    expect(svc.create).toHaveBeenCalledWith('org1', dto);
  });

  it('assess delegates dto.text + reservation', () => {
    ctrl.assess(user, { text: 'job posting' } as any, req);
    expect(svc.assess).toHaveBeenCalledWith('org1', 'job posting', reservation);
  });

  it('list delegates orgId', () => {
    ctrl.list(user);
    expect(svc.list).toHaveBeenCalledWith('org1');
  });

  it('getOne delegates to getOwned', () => {
    ctrl.getOne(user, 'j1');
    expect(svc.getOwned).toHaveBeenCalledWith('org1', 'j1');
  });

  it('analyze delegates id + reservation', () => {
    ctrl.analyze(user, 'j1', req);
    expect(svc.analyze).toHaveBeenCalledWith('org1', 'j1', reservation);
  });

  it('update delegates id + dto', () => {
    const dto = { status: 'won' } as any;
    ctrl.update(user, 'j1', dto);
    expect(svc.update).toHaveBeenCalledWith('org1', 'j1', dto);
  });
});
