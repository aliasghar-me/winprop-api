import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { SetLlmDto } from './dto/set-llm.dto';

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService, private crypto: CryptoService) {}

  async setGlobalLlm(dto: SetLlmDto) {
    const apiKeyEncrypted = this.crypto.encrypt(dto.apiKey);
    const existing = await this.prisma.llmConfig.findFirst({ where: { orgId: null } });
    if (existing) await this.prisma.llmConfig.update({ where: { id: existing.id }, data: { provider: dto.provider, model: dto.model, apiKeyEncrypted } });
    else await this.prisma.llmConfig.create({ data: { orgId: null, provider: dto.provider, model: dto.model, apiKeyEncrypted } });
    return { ok: true };
  }

  async getGlobalLlmStatus() {
    const row = await this.prisma.llmConfig.findFirst({ where: { orgId: null } });
    return { isSet: !!row, provider: row?.provider ?? null, model: row?.model ?? null, updatedAt: row?.updatedAt ?? null };
  }

  listOrgs() {
    return this.prisma.org.findMany({ select: { id: true, name: true, profession: true, plan: true } });
  }
}
