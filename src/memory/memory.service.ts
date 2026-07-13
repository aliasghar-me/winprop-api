import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { AppException } from '../common/errors/app-exception';
import { CreateMemoryDto } from './dto/create-memory.dto';
import { UpdateMemoryDto } from './dto/update-memory.dto';

type MemoryRow = {
  id: string;
  orgId: string;
  category: string;
  key: string;
  value: string;
  confidence: number;
  source: string;
  isPermanent: boolean;
  sensitive: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt: Date | null;
  deletedAt: Date | null;
  metadata: unknown;
};

// Sources allowed to overwrite an existing higher-confidence value in recordFact.
const OVERRIDE_SOURCES = new Set(['explicit', 'manual']);

@Injectable()
export class MemoryService {
  constructor(private prisma: PrismaService, private crypto: CryptoService) {}

  // Decrypt `value` on the way out when the fact is marked sensitive; otherwise
  // return the row untouched (plaintext).
  private decryptRow<T extends { value: string; sensitive: boolean }>(row: T): T {
    if (!row.sensitive) return row;
    return { ...row, value: this.crypto.decryptSafe(row.value) };
  }

  // Encrypt at rest only when the fact is sensitive.
  private encodeValue(value: string, sensitive: boolean): string {
    return sensitive ? this.crypto.encrypt(value) : value;
  }

  // All non-deleted facts, ordered by category then key; sensitive values decrypted.
  async list(orgId: string): Promise<MemoryRow[]> {
    const rows = (await this.prisma.db.userMemory.findMany({
      where: { orgId, deletedAt: null },
      orderBy: [{ category: 'asc' }, { key: 'asc' }],
    })) as MemoryRow[];
    return rows.map((r) => this.decryptRow(r));
  }

  // [{ category, count }] over non-deleted facts.
  async categories(orgId: string): Promise<{ category: string; count: number }[]> {
    const groups = await this.prisma.db.userMemory.groupBy({
      by: ['category'],
      where: { orgId, deletedAt: null },
      _count: { _all: true },
      orderBy: { category: 'asc' },
    });
    return groups.map((g: any) => ({ category: g.category, count: g._count._all }));
  }

  // Upsert by the unique (orgId, category, key): update an existing (or resurrect a
  // soft-deleted) row, else create. source='manual', confidence defaults to 1.
  async create(orgId: string, dto: CreateMemoryDto): Promise<MemoryRow> {
    const sensitive = dto.sensitive ?? false;
    const confidence = dto.confidence ?? 1;
    const value = this.encodeValue(dto.value, sensitive);
    const row = (await this.prisma.db.userMemory.upsert({
      where: { orgId_category_key: { orgId, category: dto.category, key: dto.key } },
      update: { value, sensitive, confidence, source: 'manual', deletedAt: null },
      create: { orgId, category: dto.category, key: dto.key, value, sensitive, confidence, source: 'manual' },
    })) as MemoryRow;
    return this.decryptRow(row);
  }

  // Verify org ownership (404 otherwise), then update the provided fields. Value is
  // re-encrypted when the (effective) sensitive flag is set.
  async update(orgId: string, id: string, dto: UpdateMemoryDto): Promise<MemoryRow> {
    const existing = await this.getOwned(orgId, id);
    const sensitive = dto.sensitive ?? existing.sensitive;
    const data: Record<string, unknown> = {};
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.key !== undefined) data.key = dto.key;
    if (dto.sensitive !== undefined) data.sensitive = dto.sensitive;
    if (dto.confidence !== undefined) data.confidence = dto.confidence;
    if (dto.value !== undefined) data.value = this.encodeValue(dto.value, sensitive);
    const row = (await this.prisma.userMemory.update({ where: { id }, data })) as MemoryRow;
    return this.decryptRow(row);
  }

  // Soft-delete a single fact (org-scoped).
  async remove(orgId: string, id: string): Promise<{ id: string; deletedAt: Date | null }> {
    await this.getOwned(orgId, id);
    const row = await this.prisma.userMemory.update({ where: { id }, data: { deletedAt: new Date() } });
    return { id: row.id, deletedAt: row.deletedAt };
  }

  // Soft-delete every non-deleted fact in the org, or only those in `category`.
  async removeMany(orgId: string, category?: string): Promise<{ count: number }> {
    return this.prisma.userMemory.updateMany({
      where: { orgId, deletedAt: null, ...(category ? { category } : {}) },
      data: { deletedAt: new Date() },
    });
  }

  // Portable dump of the org's non-deleted facts (values decrypted).
  async export(orgId: string) {
    const rows = await this.list(orgId);
    return rows.map((r) => ({
      category: r.category,
      key: r.key,
      value: r.value,
      confidence: r.confidence,
      source: r.source,
      isPermanent: r.isPermanent,
      sensitive: r.sensitive,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  // Auto-capture upsert. Does NOT overwrite an existing value whose confidence is
  // strictly higher UNLESS the new source is 'explicit' or 'manual'.
  async recordFact(
    orgId: string,
    fact: {
      category: string;
      key: string;
      value: string;
      confidence: number;
      source: string;
      sensitive?: boolean;
      isPermanent?: boolean;
    },
  ): Promise<MemoryRow> {
    const sensitive = fact.sensitive ?? false;
    const existing = (await this.prisma.db.userMemory.findFirst({
      where: { orgId, category: fact.category, key: fact.key, deletedAt: null },
    })) as MemoryRow | null;

    if (existing && existing.confidence > fact.confidence && !OVERRIDE_SOURCES.has(fact.source)) {
      return this.decryptRow(existing); // keep the more-confident fact
    }

    const value = this.encodeValue(fact.value, sensitive);
    const isPermanent = fact.isPermanent ?? true;
    const row = (await this.prisma.db.userMemory.upsert({
      where: { orgId_category_key: { orgId, category: fact.category, key: fact.key } },
      update: { value, sensitive, confidence: fact.confidence, source: fact.source, isPermanent, deletedAt: null },
      create: {
        orgId,
        category: fact.category,
        key: fact.key,
        value,
        sensitive,
        confidence: fact.confidence,
        source: fact.source,
        isPermanent,
      },
    })) as MemoryRow;
    return this.decryptRow(row);
  }

  // Stamp lastUsedAt=now on the given facts (org-scoped) — for prompt-reuse tracking.
  async markUsed(orgId: string, ids: string[]): Promise<{ count: number }> {
    if (!ids.length) return { count: 0 };
    return this.prisma.userMemory.updateMany({
      where: { orgId, id: { in: ids } },
      data: { lastUsedAt: new Date() },
    });
  }

  // High-confidence, NON-sensitive facts for injecting into generation prompts.
  // Sensitive values are never sent to the LLM. Stamps lastUsedAt on what we use.
  async forPrompt(orgId: string, limit = 25): Promise<{ category: string; key: string; value: string }[]> {
    const rows = (await this.prisma.db.userMemory.findMany({
      where: { orgId, deletedAt: null, sensitive: false, confidence: { gte: 0.5 } },
      orderBy: { confidence: 'desc' },
      take: limit,
    })) as MemoryRow[];
    if (rows.length) {
      await this.prisma.userMemory
        .updateMany({ where: { orgId, id: { in: rows.map((r) => r.id) } }, data: { lastUsedAt: new Date() } })
        .catch(() => undefined);
    }
    return rows.map((r) => ({ category: r.category, key: r.key, value: r.value }));
  }

  // Fetch a non-deleted fact in this org or throw 404.
  private async getOwned(orgId: string, id: string): Promise<MemoryRow> {
    const row = (await this.prisma.db.userMemory.findFirst({
      where: { id, orgId, deletedAt: null },
    })) as MemoryRow | null;
    if (!row) throw new AppException(404, 'NOT_FOUND', 'errors.memoryNotFound');
    return row;
  }
}
