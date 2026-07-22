import { MemoryController } from '../src/memory/memory.controller';

// Unit-only: instantiate MemoryController with a mocked MemoryService.
// The branch gap is the optional ?category query on removeMany.

function makeService() {
  return {
    list: jest.fn().mockResolvedValue([{ id: 'm1' }]),
    categories: jest.fn().mockResolvedValue([{ category: 'c', count: 1 }]),
    export: jest.fn().mockResolvedValue({ facts: [] }),
    audit: jest.fn().mockResolvedValue([{ id: 'a1' }]),
    import: jest.fn().mockResolvedValue({ imported: 3 }),
    create: jest.fn().mockResolvedValue({ id: 'm1' }),
    update: jest.fn().mockResolvedValue({ id: 'm1' }),
    remove: jest.fn().mockResolvedValue({ ok: true }),
    removeMany: jest.fn().mockResolvedValue({ count: 2 }),
  };
}

const user = { orgId: 'org1', userId: 'u1' } as any;

describe('MemoryController', () => {
  let svc: ReturnType<typeof makeService>;
  let ctrl: MemoryController;

  beforeEach(() => {
    svc = makeService();
    ctrl = new MemoryController(svc as any);
  });

  it('list delegates orgId', () => {
    ctrl.list(user);
    expect(svc.list).toHaveBeenCalledWith('org1');
  });

  it('categories delegates orgId', () => {
    ctrl.categories(user);
    expect(svc.categories).toHaveBeenCalledWith('org1');
  });

  it('export delegates orgId', () => {
    ctrl.export(user);
    expect(svc.export).toHaveBeenCalledWith('org1');
  });

  it('audit delegates orgId', () => {
    ctrl.audit(user);
    expect(svc.audit).toHaveBeenCalledWith('org1');
  });

  it('import delegates dto.facts', () => {
    const facts = [{ category: 'c', key: 'k', value: 'v' }];
    ctrl.import(user, { facts } as any);
    expect(svc.import).toHaveBeenCalledWith('org1', facts);
  });

  it('create delegates the dto', () => {
    const dto = { category: 'c', key: 'k', value: 'v' } as any;
    ctrl.create(user, dto);
    expect(svc.create).toHaveBeenCalledWith('org1', dto);
  });

  it('update delegates id + dto', () => {
    const dto = { value: 'v2' } as any;
    ctrl.update(user, 'm1', dto);
    expect(svc.update).toHaveBeenCalledWith('org1', 'm1', dto);
  });

  it('remove delegates id', () => {
    ctrl.remove(user, 'm1');
    expect(svc.remove).toHaveBeenCalledWith('org1', 'm1');
  });

  it('removeMany delegates the ?category when present', () => {
    ctrl.removeMany(user, 'billing');
    expect(svc.removeMany).toHaveBeenCalledWith('org1', 'billing');
  });

  it('removeMany passes undefined when ?category is absent', () => {
    ctrl.removeMany(user);
    expect(svc.removeMany).toHaveBeenCalledWith('org1', undefined);
  });
});
