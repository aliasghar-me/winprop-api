import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import { JobsService } from '../jobs/jobs.service';
import { AppException } from '../common/errors/app-exception';
import type { ToneName } from '../llm/prompt.builder';
import { DOC_TEMPLATES, validateDoc, isRegistryDocType, type RegistryDocType } from '../llm/doc-templates';

const shareBaseUrl = () =>
  process.env.PROPOSAL_SHARE_BASE_URL || `${process.env.WEB_ORIGIN?.split(',')[0] ?? 'https://proposal.winprop.ai'}/p`;

@Injectable()
export class DocumentsService {
  constructor(private prisma: PrismaService, private llm: LlmService, private jobs: JobsService) {}

  // `reservation` is the quota slot QuotaGuard reserved up-front (H2). If anything
  // below fails, we release it so a failed generation never consumes quota — the
  // same guarantee the old "write quota only on success" code gave, but now the
  // check+reserve is atomic and concurrency-safe.
  // Dispatch generation by document type: proposal keeps its dedicated path;
  // sow/estimate go through the template registry.
  async generate(orgId: string, jobId: string, type: string, reservation?: { orgId: string; periodStart: Date }) {
    if (isRegistryDocType(type)) return this.generateRegistryDoc(orgId, jobId, type, reservation);
    return this.generateProposal(orgId, jobId, reservation);
  }

  // Generate a registry document (sow/estimate): registry prompt → validate against
  // the template → persist a Document of that type. Mirrors generateProposal's quota
  // release-on-failure guarantee.
  private async generateRegistryDoc(orgId: string, jobId: string, type: RegistryDocType, reservation?: { orgId: string; periodStart: Date }) {
    try {
      const job = await this.jobs.getOwned(orgId, jobId);
      const profile = await this.prisma.profile.findUnique({ where: { orgId } });
      const org = await this.prisma.org.findUnique({ where: { id: orgId } });
      if (!profile) throw new AppException(404, 'NOT_FOUND', 'errors.profileNotFound');

      const gen = await this.llm.generateDoc({ ...profile, profession: org!.profession } as any, job, type);
      let contentJson: unknown;
      try { contentJson = JSON.parse(gen.text); } catch { throw new AppException(502, 'LLM_PROVIDER_ERROR', 'errors.llmUnreadable'); }
      if (!validateDoc(type, contentJson)) throw new AppException(502, 'LLM_PROVIDER_ERROR', 'errors.llmIncomplete');

      return await this.prisma.$transaction(async (tx: any) => {
        const doc = await tx.document.create({
          data: { jobId: job.id, type, title: `${DOC_TEMPLATES[type].titlePrefix} — ${job.title}`, contentJson, status: 'ready', version: 1 },
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
    } catch (e) {
      await this.releaseQuota(reservation);
      throw e;
    }
  }

  async generateProposal(orgId: string, jobId: string, reservation?: { orgId: string; periodStart: Date }) {
    try {
      const job = await this.jobs.getOwned(orgId, jobId);
      const profile = await this.prisma.profile.findUnique({ where: { orgId } });
      const org = await this.prisma.org.findUnique({ where: { id: orgId } });
      if (!profile) throw new AppException(404, 'NOT_FOUND', 'errors.profileNotFound');

      // LLM call OUTSIDE the tx (network).
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

      return await this.prisma.$transaction(async (tx: any) => {
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
    } catch (e) {
      await this.releaseQuota(reservation);
      throw e;
    }
  }

  private async releaseQuota(reservation?: { orgId: string; periodStart: Date }) {
    if (!reservation) return;
    await this.prisma.quotaPeriod
      .updateMany({
        where: { orgId: reservation.orgId, periodStart: reservation.periodStart, used: { gt: 0 } },
        data: { used: { decrement: 1 } },
      })
      .catch(() => undefined); // release is best-effort; never mask the original error
  }

  async getOne(orgId: string, jobId: string, docId: string) {
    await this.jobs.getOwned(orgId, jobId); // tenant scope check
    const doc = await this.prisma.document.findFirst({ where: { id: docId, jobId } });
    if (!doc) throw new AppException(404, 'NOT_FOUND', 'errors.documentNotFound');
    return doc;
  }

  // Editor save (autosave-friendly). Editing the content snapshots the previous
  // content into DocumentVersion and bumps the version (history). Title/status-only
  // changes don't create a version.
  async update(
    orgId: string,
    jobId: string,
    docId: string,
    dto: { contentJson?: Record<string, unknown>; title?: string; status?: 'draft' | 'ready' },
  ) {
    const doc = await this.getOne(orgId, jobId, docId);
    const contentChanged =
      dto.contentJson !== undefined && JSON.stringify(dto.contentJson) !== JSON.stringify(doc.contentJson);

    if (!contentChanged) {
      const data: any = {};
      if (dto.title !== undefined) data.title = dto.title;
      if (dto.status !== undefined) data.status = dto.status;
      if (Object.keys(data).length === 0) return doc;
      return this.prisma.document.update({ where: { id: doc.id }, data });
    }

    return this.prisma.$transaction(async (tx: any) => {
      await tx.documentVersion.create({
        data: { documentId: doc.id, version: doc.version, title: doc.title, contentJson: doc.contentJson as any },
      });
      return tx.document.update({
        where: { id: doc.id },
        data: {
          contentJson: dto.contentJson as any,
          version: { increment: 1 },
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
        },
      });
    });
  }

  async listVersions(orgId: string, jobId: string, docId: string) {
    await this.getOne(orgId, jobId, docId); // tenant scope + existence
    return this.prisma.documentVersion.findMany({ where: { documentId: docId }, orderBy: { version: 'desc' } });
  }

  // Create (or return existing) public share link for a document.
  async share(orgId: string, jobId: string, docId: string) {
    const doc = await this.getOne(orgId, jobId, docId);
    let token = doc.shareToken;
    if (!token) {
      token = randomBytes(9).toString('base64url'); // 12-char url-safe token
      await this.prisma.document.update({ where: { id: doc.id }, data: { shareToken: token } });
    }
    return { token, url: `${shareBaseUrl()}/${token}` };
  }

  // Revoke the public link.
  async unshare(orgId: string, jobId: string, docId: string) {
    const doc = await this.getOne(orgId, jobId, docId);
    if (doc.shareToken) await this.prisma.document.update({ where: { id: doc.id }, data: { shareToken: null } });
    return { ok: true };
  }

  // Per-section AI regenerate. Returns the suggested value (client merges + saves via
  // update()). Quota-gated like full generation; releases the reservation on failure.
  async regenerateSection(
    orgId: string,
    jobId: string,
    docId: string,
    section: any,
    reservation?: { orgId: string; periodStart: Date },
  ) {
    try {
      const doc = await this.getOne(orgId, jobId, docId);
      const job = await this.jobs.getOwned(orgId, jobId);
      const profile = await this.prisma.profile.findUnique({ where: { orgId } });
      const org = await this.prisma.org.findUnique({ where: { id: orgId } });
      if (!profile) throw new AppException(404, 'NOT_FOUND', 'errors.profileNotFound');

      const current = (doc.contentJson ?? {}) as Record<string, unknown>;
      // proposal → dedicated section prompt; sow/estimate → registry field prompt.
      const gen = isRegistryDocType(doc.type)
        ? await this.llm.regenerateDocField({ ...profile, profession: org!.profession } as any, job, doc.type, section, current)
        : await this.llm.regenerateSection({ ...profile, profession: org!.profession } as any, job, section, current);
      await this.prisma.generationLog.create({
        data: {
          orgId, jobId, provider: gen.provider, model: gen.model,
          promptTokens: gen.promptTokens, completionTokens: gen.completionTokens,
          costUsd: gen.costUsd, priceMapVersion: gen.priceMapVersion,
        },
      });
      return { section, key: gen.key, value: gen.value };
    } catch (e) {
      await this.releaseQuota(reservation);
      throw e;
    }
  }

  // T1.3 — "Adjust tone": re-run the prose sections in a new tone (one LLM call),
  // persist as a labeled timeline version. Quota-gated; releases on failure.
  async adjustTone(
    orgId: string,
    jobId: string,
    docId: string,
    tone: ToneName,
    reservation?: { orgId: string; periodStart: Date },
  ) {
    try {
      const doc = await this.getOne(orgId, jobId, docId);
      const job = await this.jobs.getOwned(orgId, jobId);
      const profile = await this.prisma.profile.findUnique({ where: { orgId } });
      const org = await this.prisma.org.findUnique({ where: { id: orgId } });
      if (!profile) throw new AppException(404, 'NOT_FOUND', 'errors.profileNotFound');
      const content = (doc.contentJson ?? {}) as Record<string, unknown>;
      const gen = await this.llm.adjustToneProse({ ...profile, profession: org!.profession } as any, job, tone, content);
      await this.logGeneration(orgId, jobId, gen);
      return this.applyAdjustment(doc, { ...content, summary: gen.summary, closing: gen.closing }, 'tone-adjust');
    } catch (e) {
      await this.releaseQuota(reservation);
      throw e;
    }
  }

  // T1.3 — "Adjust pricing": re-run only the price, CLAMPED to the agency's range,
  // persist as a labeled version. Quota-gated; releases on failure.
  async adjustPricing(
    orgId: string,
    jobId: string,
    docId: string,
    reservation?: { orgId: string; periodStart: Date },
  ) {
    try {
      const doc = await this.getOne(orgId, jobId, docId);
      const job = await this.jobs.getOwned(orgId, jobId);
      const profile = await this.prisma.profile.findUnique({ where: { orgId } });
      const org = await this.prisma.org.findUnique({ where: { id: orgId } });
      if (!profile) throw new AppException(404, 'NOT_FOUND', 'errors.profileNotFound');
      const content = (doc.contentJson ?? {}) as Record<string, unknown>;
      const gen = await this.llm.regenerateSection({ ...profile, profession: org!.profession } as any, job, 'pricing', content);
      await this.logGeneration(orgId, jobId, gen);
      // Bound the suggestion to the agency's pricing range (never present out-of-range).
      const raw = Number(gen.value);
      const price = Number.isFinite(raw) ? Math.min(profile.priceMax, Math.max(profile.priceMin, Math.round(raw))) : profile.priceMin;
      return this.applyAdjustment(doc, { ...content, priceUsd: price }, 'pricing-adjust');
    } catch (e) {
      await this.releaseQuota(reservation);
      throw e;
    }
  }

  // Snapshot the current content into the timeline (tagged with `label`) and bump
  // the live document to the adjusted content — mirrors update()'s versioning.
  private async applyAdjustment(doc: any, nextContent: Record<string, unknown>, label: string) {
    return this.prisma.$transaction(async (tx: any) => {
      await tx.documentVersion.create({
        data: { documentId: doc.id, version: doc.version, title: doc.title, contentJson: doc.contentJson as any, label },
      });
      return tx.document.update({
        where: { id: doc.id },
        data: { contentJson: nextContent as any, version: { increment: 1 } },
      });
    });
  }

  private async logGeneration(
    orgId: string,
    jobId: string,
    gen: { provider: string; model: string; promptTokens: number; completionTokens: number; costUsd: number; priceMapVersion: string },
  ) {
    await this.prisma.generationLog.create({
      data: {
        orgId, jobId, provider: gen.provider, model: gen.model,
        promptTokens: gen.promptTokens, completionTokens: gen.completionTokens,
        costUsd: gen.costUsd, priceMapVersion: gen.priceMapVersion,
      },
    });
  }
}
