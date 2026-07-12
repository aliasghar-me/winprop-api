import { tenantExtension } from '../src/common/tenant/prisma-tenant.extension';
import { tenantStorage } from '../src/common/tenant/tenant-context';

// Unit-only: extract the $allOperations hook from the Prisma extension by handing
// tenantExtension a fake client that captures the config it passes to $extends,
// then drive the hook directly. `query` is a spy so we can inspect the args it
// receives after (or without) tenant injection.

let hook: (arg: any) => Promise<any>;
beforeAll(() => {
  let captured: any;
  const fakeClient: any = { $extends: (cfg: any) => { captured = cfg; return {}; } };
  (tenantExtension as any)(fakeClient);
  hook = captured.query.$allModels.$allOperations;
});

const run = (store: any, fn: () => Promise<any>) =>
  store === undefined ? fn() : tenantStorage.run(store, fn);

const call = (opts: { model?: string; operation: string; args?: any; store?: any }) => {
  const query = jest.fn((a: any) => Promise.resolve(a));
  const p = run(opts.store, () => hook({ model: opts.model, operation: opts.operation, args: opts.args ?? {}, query }));
  return { query, result: p };
};

describe('tenantExtension $allOperations', () => {
  const prevMode = process.env.TENANT_EXTENSION_MODE;
  afterEach(() => { process.env.TENANT_EXTENSION_MODE = prevMode; });

  it('passes through for a non-tenant model', async () => {
    process.env.TENANT_EXTENSION_MODE = 'enforce';
    const { query, result } = call({ model: 'User', operation: 'findMany', args: { where: { x: 1 } }, store: { bypass: false, orgId: 'o1' } });
    await result;
    expect(query).toHaveBeenCalledWith({ where: { x: 1 } });
  });

  it('passes through when model is undefined (raw/$queryRaw operations)', async () => {
    process.env.TENANT_EXTENSION_MODE = 'enforce';
    const query = jest.fn((a: any) => Promise.resolve(a));
    await tenantStorage.run({ bypass: false, orgId: 'o1' }, () =>
      hook({ model: undefined, operation: 'findMany', args: { where: { x: 1 } }, query }));
    expect(query).toHaveBeenCalledWith({ where: { x: 1 } });
  });

  it('tolerates undefined args in enforce mode (nullish fallbacks)', async () => {
    process.env.TENANT_EXTENSION_MODE = 'enforce';
    const store = { bypass: false, orgId: 'o1' };
    // WHERE_OP with args undefined -> a = {}, where set fresh
    const q1 = jest.fn((a: any) => Promise.resolve(a));
    await tenantStorage.run(store, () => hook({ model: 'Job', operation: 'findMany', args: undefined, query: q1 }));
    expect(q1).toHaveBeenCalledWith({ where: { orgId: 'o1' } });
    // create with no data -> data becomes just the tenant key
    const q2 = jest.fn((a: any) => Promise.resolve(a));
    await tenantStorage.run(store, () => hook({ model: 'Job', operation: 'create', args: {}, query: q2 }));
    expect(q2).toHaveBeenCalledWith({ data: { orgId: 'o1' } });
    // upsert with no create branch -> create becomes just the tenant key
    const q3 = jest.fn((a: any) => Promise.resolve(a));
    await tenantStorage.run(store, () => hook({ model: 'Job', operation: 'upsert', args: { where: { id: 'j1' } }, query: q3 }));
    expect(q3).toHaveBeenCalledWith({ where: { id: 'j1' }, create: { orgId: 'o1' } });
  });

  it('passes through when there is no tenant store (CLI/seed)', async () => {
    process.env.TENANT_EXTENSION_MODE = 'enforce';
    const { query, result } = call({ model: 'Job', operation: 'findMany', args: {}, store: undefined });
    await result;
    expect(query).toHaveBeenCalledWith({});
  });

  it('passes through when the store is in bypass mode', async () => {
    process.env.TENANT_EXTENSION_MODE = 'enforce';
    const { query, result } = call({ model: 'Job', operation: 'findMany', store: { bypass: true, orgId: 'o1' } });
    await result;
    expect(query).toHaveBeenCalled();
  });

  it('fails closed when a tenant model is queried with no orgId in enforce mode', async () => {
    process.env.TENANT_EXTENSION_MODE = 'enforce';
    const { result } = call({ model: 'Job', operation: 'findMany', store: { bypass: false } });
    await expect(result).rejects.toMatchObject({ code: 'P2025' });
  });

  it('logs and passes through when orgId missing in audit mode', async () => {
    process.env.TENANT_EXTENSION_MODE = 'audit';
    const { query, result } = call({ model: 'Job', operation: 'findMany', args: { where: { a: 1 } }, store: { bypass: false } });
    await result;
    expect(query).toHaveBeenCalledWith({ where: { a: 1 } });
  });

  it('audit mode with orgId present only logs — no mutation of args', async () => {
    process.env.TENANT_EXTENSION_MODE = 'audit';
    const { query, result } = call({ model: 'Job', operation: 'findMany', args: { where: { a: 1 } }, store: { bypass: false, orgId: 'o1' } });
    await result;
    expect(query).toHaveBeenCalledWith({ where: { a: 1 } });
  });

  describe('enforce-mode injection', () => {
    beforeEach(() => { process.env.TENANT_EXTENSION_MODE = 'enforce'; });

    it('ANDs the tenant key onto an existing where (findMany)', async () => {
      const { query, result } = call({ model: 'Job', operation: 'findMany', args: { where: { title: 'x' } }, store: { bypass: false, orgId: 'o1' } });
      await result;
      expect(query).toHaveBeenCalledWith({ where: { AND: [{ title: 'x' }, { orgId: 'o1' }] } });
    });

    it('sets a where when none was provided (count)', async () => {
      const { query, result } = call({ model: 'Job', operation: 'count', args: {}, store: { bypass: false, orgId: 'o1' } });
      await result;
      expect(query).toHaveBeenCalledWith({ where: { orgId: 'o1' } });
    });

    it('uses the id column for the Org model', async () => {
      const { query, result } = call({ model: 'Org', operation: 'updateMany', args: {}, store: { bypass: false, orgId: 'o1' } });
      await result;
      expect(query).toHaveBeenCalledWith({ where: { id: 'o1' } });
    });

    it('forces the tenant key on create data (overwriting client-supplied)', async () => {
      const { query, result } = call({ model: 'Job', operation: 'create', args: { data: { title: 't', orgId: 'attacker' } }, store: { bypass: false, orgId: 'o1' } });
      await result;
      expect(query).toHaveBeenCalledWith({ data: { title: 't', orgId: 'o1' } });
    });

    it('injects the tenant key into every row of a createMany array', async () => {
      const { query, result } = call({ model: 'Job', operation: 'createMany', args: { data: [{ title: 'a' }, { title: 'b' }] }, store: { bypass: false, orgId: 'o1' } });
      await result;
      expect(query).toHaveBeenCalledWith({ data: [{ title: 'a', orgId: 'o1' }, { title: 'b', orgId: 'o1' }] });
    });

    it('wraps a single-object createMany payload', async () => {
      const { query, result } = call({ model: 'Job', operation: 'createMany', args: { data: { title: 'a' } }, store: { bypass: false, orgId: 'o1' } });
      await result;
      expect(query).toHaveBeenCalledWith({ data: [{ title: 'a', orgId: 'o1' }] });
    });

    it('injects only into the create branch of an upsert (leaves the unique where alone)', async () => {
      const { query, result } = call({ model: 'Job', operation: 'upsert', args: { where: { id: 'j1' }, create: { title: 'a' }, update: { title: 'b' } }, store: { bypass: false, orgId: 'o1' } });
      await result;
      expect(query).toHaveBeenCalledWith({ where: { id: 'j1' }, create: { title: 'a', orgId: 'o1' }, update: { title: 'b' } });
    });

    it('leaves non-where/non-create operations (e.g. findUnique) untouched', async () => {
      const { query, result } = call({ model: 'Job', operation: 'findUnique', args: { where: { id: 'j1' } }, store: { bypass: false, orgId: 'o1' } });
      await result;
      expect(query).toHaveBeenCalledWith({ where: { id: 'j1' } });
    });
  });
});
