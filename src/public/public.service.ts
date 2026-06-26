import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/errors/app-exception';

// Read model for a publicly-shared proposal. Returns ONLY what a recipient needs
// to render it — never org ids, emails, pricing config, or other tenant internals.
@Injectable()
export class PublicService {
  constructor(private prisma: PrismaService) {}

  async getSharedProposal(token: string) {
    const doc = await this.prisma.document.findUnique({
      where: { shareToken: token },
      include: { job: { include: { org: { include: { profile: true } } } } },
    });
    if (!doc) throw new AppException(404, 'NOT_FOUND', 'errors.documentNotFound');
    const profile = doc.job.org.profile;
    return {
      title: doc.title,
      contentJson: doc.contentJson,
      updatedAt: doc.updatedAt,
      brand: profile
        ? { agencyName: profile.agencyName, logoUrl: profile.logoUrl, brandColor: profile.brandColor, brandShort: profile.brandShort }
        : null,
    };
  }
}
