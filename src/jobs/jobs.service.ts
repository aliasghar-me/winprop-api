import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/errors/app-exception';

const normalize = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

@Injectable()
export class JobsService {
  constructor(private prisma: PrismaService) {}

  async create(orgId: string, title: string, company?: string) {
    const norm = normalize(title);
    const clash = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Job"
      WHERE "orgId" = ${orgId}
        AND lower(regexp_replace(btrim("title"), '\\s+', ' ', 'g')) = ${norm}
      LIMIT 1`;
    if (clash.length) throw new AppException(409, 'DUPLICATE_NAME', 'errors.duplicateName', { name: title.trim() });
    try {
      return await this.prisma.job.create({ data: { orgId, title: title.trim(), company: company ?? '—' } });
    } catch (e: any) {
      const msg = String(e?.message ?? '');
      if (e?.code === 'P2002' || /job_org_title_uniq/.test(msg) || e?.meta?.code === '23505')
        throw new AppException(409, 'DUPLICATE_NAME', 'errors.duplicateName', { name: title.trim() });
      throw e;
    }
  }

  list(orgId: string) {
    return this.prisma.job.findMany({ where: { orgId }, orderBy: { createdAt: 'desc' } });
  }

  async getOwned(orgId: string, jobId: string) {
    const job = await this.prisma.job.findFirst({ where: { id: jobId, orgId } });
    if (!job) throw new AppException(404, 'NOT_FOUND', 'errors.jobNotFound');
    return job;
  }
}
