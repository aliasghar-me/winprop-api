import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import { JobsService } from '../jobs/jobs.service';
import { AppException } from '../common/errors/app-exception';

@Injectable()
export class DocumentsService {
  constructor(private prisma: PrismaService, private llm: LlmService, private jobs: JobsService) {}

  async generateProposal(orgId: string, jobId: string) {
    const job = await this.jobs.getOwned(orgId, jobId);
    const profile = await this.prisma.profile.findUnique({ where: { orgId } });
    const org = await this.prisma.org.findUnique({ where: { id: orgId } });
    if (!profile) throw new AppException(404, 'NOT_FOUND', 'errors.profileNotFound');

    // LLM call OUTSIDE the tx (network). Persistence + quota write happen INSIDE the tx,
    // and only on success — so a failed generation never consumes quota.
    const gen = await this.llm.generateProposal({ ...profile, profession: org!.profession } as any, job);
    let contentJson: any;
    try {
      contentJson = JSON.parse(gen.text);
    } catch {
      throw new AppException(502, 'LLM_PROVIDER_ERROR', 'errors.llmUnreadable');
    }
    if (!contentJson || typeof contentJson !== 'object' || typeof contentJson.summary !== 'string' || contentJson.summary.trim() === '') {
      throw new AppException(502, 'LLM_PROVIDER_ERROR', 'errors.llmIncomplete');
    }

    return this.prisma.$transaction(async (tx: any) => {
      const doc = await tx.document.create({
        data: { jobId: job.id, type: 'proposal', title: `Proposal — ${job.title}`, contentJson, status: 'ready', version: 1 },
      });
      await tx.generationLog.create({
        data: {
          orgId, jobId: job.id, provider: gen.provider, model: gen.model,
          promptTokens: gen.promptTokens, completionTokens: gen.completionTokens,
          costUsd: gen.costUsd, priceMapVersion: gen.priceMapVersion,
        },
      });
      return doc;
    });
  }

  async getOne(orgId: string, jobId: string, docId: string) {
    await this.jobs.getOwned(orgId, jobId); // tenant scope check
    const doc = await this.prisma.document.findFirst({ where: { id: docId, jobId } });
    if (!doc) throw new AppException(404, 'NOT_FOUND', 'errors.documentNotFound');
    return doc;
  }
}
