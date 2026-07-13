import { MemoryService } from '../src/memory/memory.service';

// Hand-rolled fakes for MemoryService's deps (PrismaService + tenant-scoped
// prisma.db accessor, CryptoService). No Nest DI, no Postgres. Fake crypto uses a
// reversible "enc:" prefix so we can assert encrypt-on-write / decrypt-on-read.

const fakeCrypto = () => ({
  encrypt: jest.fn((s: string) => 'enc:' + s),
  decryptSafe: jest.fn((s: string) => (s ?? '').replace('enc:', '')),
});

function row(over: Record<string, any> = {}) {
  return {
    id: 'm1',
    orgId: 'org1',
    category: 'tone',
    key: 'style',
    value: 'friendly',
    confidence: 1,
    source: 'manual',
    isPermanent: true,
    sensitive: false,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
    lastUsedAt: null,
    deletedAt: null,
    metadata: null,
    ...over,
  };
}

function makeDeps(over: { db?: any; base?: any } = {}) {
  const dbUserMemory = {
    findMany: jest.fn().mockResolvedValue([row()]),
    findFirst: jest.fn().mockResolvedValue(row()),
    groupBy: jest.fn().mockResolvedValue([{ category: 'tone', _count: { _all: 2 } }]),
    upsert: jest.fn().mockImplementation(({ create, update }: any) => Promise.resolve(row({ ...create, ...update }))),
    ...(over.db ?? {}),
  };
  const baseUserMemory = {
    update: jest.fn().mockImplementation(({ where, data }: any) => Promise.resolve(row({ id: where.id, ...data }))),
    updateMany: jest.fn().mockResolvedValue({ count: 3 }),
    ...(over.base ?? {}),
  };
  const memoryAuditLog = {
    create: jest.fn().mockResolvedValue({ id: 'a1' }),
    findMany: jest.fn().mockResolvedValue([{ id: 'a1', action: 'created' }]),
    ...((over as any).audit ?? {}),
  };
  const prisma: any = { db: { userMemory: dbUserMemory, memoryAuditLog }, userMemory: baseUserMemory };
  const crypto: any = fakeCrypto();
  const svc = new MemoryService(prisma, crypto);
  return { svc, prisma, crypto, dbUserMemory, baseUserMemory, memoryAuditLog };
}

describe('MemoryService.forPrompt', () => {
  it('returns compact non-sensitive high-confidence facts and stamps lastUsedAt', async () => {
    const { svc, dbUserMemory, baseUserMemory } = makeDeps({
      db: { findMany: jest.fn().mockResolvedValue([row({ id: 'a', category: 'technical', key: 'stack', value: 'Next.js' })]) },
    });
    const out = await svc.forPrompt('org1');
    expect(dbUserMemory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId: 'org1', deletedAt: null, sensitive: false, confidence: { gte: 0.5 } } }),
    );
    expect(out).toEqual([{ category: 'technical', key: 'stack', value: 'Next.js' }]);
    expect(baseUserMemory.updateMany).toHaveBeenCalled();
  });

  it('returns [] and skips the markUsed write when there are no facts', async () => {
    const { svc, baseUserMemory } = makeDeps({ db: { findMany: jest.fn().mockResolvedValue([]) } });
    expect(await svc.forPrompt('org1')).toEqual([]);
    expect(baseUserMemory.updateMany).not.toHaveBeenCalled();
  });
});

describe('MemoryService.list', () => {
  it('lists non-deleted facts ordered by category then key', async () => {
    const { svc, dbUserMemory } = makeDeps();
    await svc.list('org1');
    expect(dbUserMemory.findMany).toHaveBeenCalledWith({
      where: { orgId: 'org1', deletedAt: null },
      orderBy: [{ category: 'asc' }, { key: 'asc' }],
    });
  });

  it('decrypts sensitive values on read and leaves plaintext untouched', async () => {
    const { svc } = makeDeps({
      db: { findMany: jest.fn().mockResolvedValue([row({ sensitive: true, value: 'enc:secret' }), row({ id: 'm2', value: 'plain' })]) },
    });
    const out = await svc.list('org1');
    expect(out[0].value).toBe('secret');
    expect(out[1].value).toBe('plain');
  });
});

describe('MemoryService.categories', () => {
  it('returns [{category,count}] from a grouped, non-deleted query', async () => {
    const { svc, dbUserMemory } = makeDeps();
    const out = await svc.categories('org1');
    expect(dbUserMemory.groupBy).toHaveBeenCalledWith({
      by: ['category'],
      where: { orgId: 'org1', deletedAt: null },
      _count: { _all: true },
      orderBy: { category: 'asc' },
    });
    expect(out).toEqual([{ category: 'tone', count: 2 }]);
  });
});

describe('MemoryService.create', () => {
  it('upserts a plaintext fact with source=manual and default confidence 1', async () => {
    const { svc, dbUserMemory, crypto } = makeDeps();
    await svc.create('org1', { category: 'tone', key: 'style', value: 'friendly' } as any);
    expect(crypto.encrypt).not.toHaveBeenCalled();
    expect(dbUserMemory.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orgId_category_key: { orgId: 'org1', category: 'tone', key: 'style' } },
        update: expect.objectContaining({ value: 'friendly', sensitive: false, confidence: 1, source: 'manual', deletedAt: null }),
        create: expect.objectContaining({ orgId: 'org1', value: 'friendly', source: 'manual' }),
      }),
    );
  });

  it('encrypts value on write when sensitive and decrypts the returned row', async () => {
    const { svc, dbUserMemory, crypto } = makeDeps();
    const out = await svc.create('org1', { category: 'rates', key: 'hourly', value: '250', sensitive: true, confidence: 0.5 } as any);
    expect(crypto.encrypt).toHaveBeenCalledWith('250');
    expect(dbUserMemory.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ value: 'enc:250', sensitive: true, confidence: 0.5 }) }),
    );
    expect(out.value).toBe('250'); // decrypted on the way out
  });
});

describe('MemoryService.update', () => {
  it('throws NOT_FOUND when the row is not in this org', async () => {
    const { svc } = makeDeps({ db: { findFirst: jest.fn().mockResolvedValue(null) } });
    await expect(svc.update('org1', 'nope', { value: 'x' } as any)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      translationKey: 'errors.memoryNotFound',
    });
  });

  it('updates category/key/confidence and re-encrypts a value when effective sensitive', async () => {
    const { svc, baseUserMemory, crypto } = makeDeps({ db: { findFirst: jest.fn().mockResolvedValue(row({ sensitive: true })) } });
    await svc.update('org1', 'm1', { category: 'c2', key: 'k2', confidence: 0.3, value: 'v' } as any);
    expect(crypto.encrypt).toHaveBeenCalledWith('v');
    expect(baseUserMemory.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { category: 'c2', key: 'k2', confidence: 0.3, value: 'enc:v' },
    });
  });

  it('stores a value as plaintext when sensitive is turned off in the same call', async () => {
    const { svc, baseUserMemory, crypto } = makeDeps({ db: { findFirst: jest.fn().mockResolvedValue(row({ sensitive: true })) } });
    await svc.update('org1', 'm1', { value: 'v', sensitive: false } as any);
    expect(crypto.encrypt).not.toHaveBeenCalled();
    expect(baseUserMemory.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { sensitive: false, value: 'v' } });
  });

  it('updates without a value (no encryption attempted)', async () => {
    const { svc, baseUserMemory, crypto } = makeDeps();
    await svc.update('org1', 'm1', { confidence: 0.9 } as any);
    expect(crypto.encrypt).not.toHaveBeenCalled();
    expect(baseUserMemory.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { confidence: 0.9 } });
  });
});

describe('MemoryService.remove', () => {
  it('soft-deletes an owned fact', async () => {
    const { svc, baseUserMemory } = makeDeps();
    const out = await svc.remove('org1', 'm1');
    expect(baseUserMemory.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { deletedAt: expect.any(Date) } });
    expect(out.id).toBe('m1');
  });

  it('throws NOT_FOUND for a fact outside the org', async () => {
    const { svc } = makeDeps({ db: { findFirst: jest.fn().mockResolvedValue(null) } });
    await expect(svc.remove('org1', 'm1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('MemoryService.removeMany', () => {
  it('soft-deletes every non-deleted fact in the org', async () => {
    const { svc, baseUserMemory } = makeDeps();
    await svc.removeMany('org1');
    expect(baseUserMemory.updateMany).toHaveBeenCalledWith({
      where: { orgId: 'org1', deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it('scopes the soft-delete to a category when provided', async () => {
    const { svc, baseUserMemory } = makeDeps();
    await svc.removeMany('org1', 'tone');
    expect(baseUserMemory.updateMany).toHaveBeenCalledWith({
      where: { orgId: 'org1', deletedAt: null, category: 'tone' },
      data: { deletedAt: expect.any(Date) },
    });
  });
});

describe('MemoryService.export', () => {
  it('returns the flat portable shape with decrypted values', async () => {
    const { svc } = makeDeps({
      db: { findMany: jest.fn().mockResolvedValue([row({ sensitive: true, value: 'enc:250', category: 'rates', key: 'hourly' })]) },
    });
    const out = await svc.export('org1');
    expect(out).toEqual([
      expect.objectContaining({ category: 'rates', key: 'hourly', value: '250', source: 'manual', isPermanent: true, sensitive: true }),
    ]);
    expect(out[0]).not.toHaveProperty('id');
    expect(out[0]).not.toHaveProperty('deletedAt');
  });
});

describe('MemoryService.recordFact', () => {
  it('creates a new fact via upsert when none exists', async () => {
    const { svc, dbUserMemory } = makeDeps({ db: { findFirst: jest.fn().mockResolvedValue(null) } });
    await svc.recordFact('org1', { category: 'tone', key: 'style', value: 'bold', confidence: 0.6, source: 'conversation' });
    expect(dbUserMemory.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ value: 'bold', confidence: 0.6, source: 'conversation', isPermanent: true }) }),
    );
  });

  it('does NOT overwrite a higher-confidence fact from a non-explicit source', async () => {
    const { svc, dbUserMemory } = makeDeps({ db: { findFirst: jest.fn().mockResolvedValue(row({ confidence: 0.9, value: 'kept' })) } });
    const out = await svc.recordFact('org1', { category: 'tone', key: 'style', value: 'new', confidence: 0.3, source: 'conversation' });
    expect(dbUserMemory.upsert).not.toHaveBeenCalled();
    expect(out.value).toBe('kept');
  });

  it('lets an explicit source override a higher-confidence fact', async () => {
    const { svc, dbUserMemory } = makeDeps({ db: { findFirst: jest.fn().mockResolvedValue(row({ confidence: 0.9 })) } });
    await svc.recordFact('org1', { category: 'tone', key: 'style', value: 'new', confidence: 0.3, source: 'explicit' });
    expect(dbUserMemory.upsert).toHaveBeenCalled();
  });

  it('lets a manual source override a higher-confidence fact', async () => {
    const { svc, dbUserMemory } = makeDeps({ db: { findFirst: jest.fn().mockResolvedValue(row({ confidence: 0.9 })) } });
    await svc.recordFact('org1', { category: 'tone', key: 'style', value: 'new', confidence: 0.3, source: 'manual' });
    expect(dbUserMemory.upsert).toHaveBeenCalled();
  });

  it('overwrites when the new (non-explicit) confidence is equal-or-higher', async () => {
    const { svc, dbUserMemory } = makeDeps({ db: { findFirst: jest.fn().mockResolvedValue(row({ confidence: 0.5 })) } });
    await svc.recordFact('org1', { category: 'tone', key: 'style', value: 'new', confidence: 0.5, source: 'outcome' });
    expect(dbUserMemory.upsert).toHaveBeenCalled();
  });

  it('encrypts a sensitive fact on write', async () => {
    const { svc, crypto } = makeDeps({ db: { findFirst: jest.fn().mockResolvedValue(null) } });
    await svc.recordFact('org1', { category: 'rates', key: 'min', value: '5000', confidence: 0.8, source: 'profile', sensitive: true, isPermanent: false });
    expect(crypto.encrypt).toHaveBeenCalledWith('5000');
  });
});

describe('MemoryService.markUsed', () => {
  it('stamps lastUsedAt on the given ids', async () => {
    const { svc, baseUserMemory } = makeDeps();
    await svc.markUsed('org1', ['m1', 'm2']);
    expect(baseUserMemory.updateMany).toHaveBeenCalledWith({
      where: { orgId: 'org1', id: { in: ['m1', 'm2'] } },
      data: { lastUsedAt: expect.any(Date) },
    });
  });

  it('is a no-op for an empty id list', async () => {
    const { svc, baseUserMemory } = makeDeps();
    const out = await svc.markUsed('org1', []);
    expect(baseUserMemory.updateMany).not.toHaveBeenCalled();
    expect(out).toEqual({ count: 0 });
  });
});

describe('MemoryService.import', () => {
  it('records each fact via recordFact and returns the count', async () => {
    const { svc, dbUserMemory } = makeDeps({ db: { findFirst: jest.fn().mockResolvedValue(null) } });
    const out = await svc.import('org1', [
      { category: 'technical', key: 'stack', value: 'Next.js' },
      { category: 'tone', key: 'style', value: 'friendly' },
    ] as any);
    expect(out).toEqual({ imported: 2 });
    expect(dbUserMemory.upsert).toHaveBeenCalledTimes(2);
  });

  it('defaults source to "import" and confidence to 0.9 when absent', async () => {
    const { svc, dbUserMemory } = makeDeps({ db: { findFirst: jest.fn().mockResolvedValue(null) } });
    await svc.import('org1', [{ category: 'technical', key: 'stack', value: 'Next.js' }] as any);
    expect(dbUserMemory.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ source: 'import', confidence: 0.9 }) }),
    );
  });

  it('honors an explicit source/confidence from the imported fact', async () => {
    const { svc, dbUserMemory } = makeDeps({ db: { findFirst: jest.fn().mockResolvedValue(null) } });
    await svc.import('org1', [{ category: 'technical', key: 'stack', value: 'Next.js', source: 'explicit', confidence: 0.4 }] as any);
    expect(dbUserMemory.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ source: 'explicit', confidence: 0.4 }) }),
    );
  });

  it('writes an "imported" audit entry', async () => {
    const { svc, memoryAuditLog } = makeDeps({ db: { findFirst: jest.fn().mockResolvedValue(null) } });
    await svc.import('org1', [{ category: 'technical', key: 'stack', value: 'Next.js' }] as any);
    expect(memoryAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ orgId: 'org1', action: 'imported', detail: { imported: 1 } }) }),
    );
  });
});

describe('MemoryService audit trail', () => {
  it('writes a "created" audit entry with a short value for a non-sensitive fact', async () => {
    const { svc, memoryAuditLog } = makeDeps();
    await svc.create('org1', { category: 'tone', key: 'style', value: 'friendly' } as any);
    expect(memoryAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'created', category: 'tone', key: 'style', detail: { value: 'friendly' } }) }),
    );
  });

  it('NEVER writes a decrypted sensitive value into the audit detail on create', async () => {
    const { svc, memoryAuditLog } = makeDeps();
    await svc.create('org1', { category: 'rates', key: 'hourly', value: '250', sensitive: true } as any);
    const call = memoryAuditLog.create.mock.calls[0][0];
    expect(call.data.detail).toEqual({ sensitive: true });
    expect(JSON.stringify(call.data)).not.toContain('250');
  });

  it('writes an "updated" audit entry and hides the value for a sensitive fact', async () => {
    const { svc, memoryAuditLog } = makeDeps({ db: { findFirst: jest.fn().mockResolvedValue(row({ sensitive: true })) } });
    await svc.update('org1', 'm1', { value: 'secret-new' } as any);
    const call = memoryAuditLog.create.mock.calls[0][0];
    expect(call.data.action).toBe('updated');
    expect(call.data.detail).toEqual({ sensitive: true });
    expect(JSON.stringify(call.data)).not.toContain('secret-new');
  });

  it('writes a "deleted" audit entry on remove', async () => {
    const { svc, memoryAuditLog } = makeDeps();
    await svc.remove('org1', 'm1');
    expect(memoryAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'deleted', memoryId: 'm1' }) }),
    );
  });

  it('writes a "deleted_many" audit entry on removeMany', async () => {
    const { svc, memoryAuditLog } = makeDeps();
    await svc.removeMany('org1', 'tone');
    expect(memoryAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'deleted_many', category: 'tone', detail: { count: 3, category: 'tone' } }) }),
    );
  });

  it('never lets an audit-write failure break the operation', async () => {
    const { svc } = makeDeps({ audit: { create: jest.fn().mockRejectedValue(new Error('audit down')) } } as any);
    const out = await svc.create('org1', { category: 'tone', key: 'style', value: 'friendly' } as any);
    expect(out.value).toBe('friendly'); // operation still succeeds
  });
});

describe('MemoryService.audit', () => {
  it('returns recent audit entries newest-first', async () => {
    const { svc, memoryAuditLog } = makeDeps();
    const out = await svc.audit('org1');
    expect(memoryAuditLog.findMany).toHaveBeenCalledWith({
      where: { orgId: 'org1' },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    expect(out).toEqual([{ id: 'a1', action: 'created' }]);
  });
});
