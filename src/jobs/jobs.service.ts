import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/errors/app-exception';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';

const normalize = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

// Rich client/opportunity fields persisted on create + update.
const RICH_FIELDS = ['clientName', 'clientEmail', 'clientWebsite', 'projectDescription', 'requirements', 'budget', 'timeline'] as const;

@Injectable()
export class JobsService {
  constructor(private prisma: PrismaService) {}

  // Throws DUPLICATE_NAME if another job in the org has the same normalized title.
  private async assertTitleFree(orgId: string, title: string, exceptId?: string) {
    const norm = normalize(title);
    const clash = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Job"
      WHERE "orgId" = ${orgId}
        AND id <> ${exceptId ?? ''}
        AND lower(regexp_replace(btrim("title"), '\\s+', ' ', 'g')) = ${norm}
      LIMIT 1`;
    if (clash.length) throw new AppException(409, 'DUPLICATE_NAME', 'errors.duplicateName', { name: title.trim() });
  }

  async create(orgId: string, dto: CreateJobDto) {
    await this.assertTitleFree(orgId, dto.title);
    const rich = this.pickRich(dto);
    try {
      return await this.prisma.job.create({
        data: { orgId, title: dto.title.trim(), company: dto.company ?? '—', ...rich },
      });
    } catch (e: any) {
      const msg = String(e?.message ?? '');
      if (e?.code === 'P2002' || /job_org_title_uniq/.test(msg) || e?.meta?.code === '23505')
        throw new AppException(409, 'DUPLICATE_NAME', 'errors.duplicateName', { name: dto.title.trim() });
      throw e;
    }
  }

  async update(orgId: string, jobId: string, dto: UpdateJobDto) {
    await this.getOwned(orgId, jobId); // tenant scope + existence
    if (dto.title !== undefined) await this.assertTitleFree(orgId, dto.title, jobId);
    const data: Record<string, any> = { ...this.pickRich(dto) };
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.company !== undefined) data.company = dto.company;
    if (dto.status !== undefined) data.status = dto.status;
    return this.prisma.job.update({ where: { id: jobId }, data });
  }

  private pickRich(dto: CreateJobDto | UpdateJobDto) {
    const out: Record<string, any> = {};
    for (const f of RICH_FIELDS) if ((dto as any)[f] !== undefined) out[f] = (dto as any)[f];
    return out;
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
