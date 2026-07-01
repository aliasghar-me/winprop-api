import { Injectable, Logger } from '@nestjs/common';
import { chromium, type LaunchOptions } from 'playwright';
import { PrismaService } from '../prisma/prisma.service';
import { JobsService } from '../jobs/jobs.service';
import { AppException } from '../common/errors/app-exception';
import { buildProposalHtml, buildDocHtml } from './proposal-html';
import { DOC_TEMPLATES, isRegistryDocType } from '../llm/doc-templates';

@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);
  constructor(private prisma: PrismaService, private jobs: JobsService) {}

  // Render a branded proposal PDF server-side (consistent across clients, embeds the
  // logo/brand). Tenant-scoped via the job's ownership check.
  async renderProposalPdf(orgId: string, jobId: string, docId: string): Promise<Buffer> {
    await this.jobs.getOwned(orgId, jobId); // tenant scope + existence
    const doc = await this.prisma.document.findFirst({ where: { id: docId, jobId } });
    if (!doc) throw new AppException(404, 'NOT_FOUND', 'errors.documentNotFound');
    const profile = await this.prisma.profile.findUnique({ where: { orgId } });
    const html = isRegistryDocType(doc.type)
      ? buildDocHtml(doc, profile, DOC_TEMPLATES[doc.type].fields)
      : buildProposalHtml(doc, profile);

    // In prod the Docker image installs Chromium (bundled). Locally / where a system
    // Chrome exists, set PLAYWRIGHT_CHROMIUM_CHANNEL=chrome to avoid the download.
    const opts: LaunchOptions = {};
    if (process.env.PLAYWRIGHT_CHROMIUM_CHANNEL) opts.channel = process.env.PLAYWRIGHT_CHROMIUM_CHANNEL;
    const browser = await chromium.launch(opts);
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      return await page.pdf({ format: 'A4', printBackground: true, margin: { top: '0', bottom: '0', left: '0', right: '0' } });
    } catch (e: unknown) {
      this.logger.error(`PDF render failed: ${e instanceof Error ? e.message : String(e)}`);
      throw new AppException(502, 'EXPORT_FAILED', 'errors.exportFailed');
    } finally {
      await browser.close();
    }
  }
}
