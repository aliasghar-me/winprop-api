import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/errors/app-exception';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class ProfileService {
  constructor(private prisma: PrismaService) {}

  async get(orgId: string) {
    const profile = await this.prisma.profile.findUnique({ where: { orgId } });
    if (!profile) throw new AppException(404, 'NOT_FOUND', 'errors.profileNotFound');
    return profile;
  }

  async update(orgId: string, dto: UpdateProfileDto) {
    await this.get(orgId); // existence + tenant scope
    const data: Prisma.ProfileUpdateInput = {};
    for (const [k, v] of Object.entries(dto)) {
      if (v === undefined) continue;
      // caseStudies/testimonials are Json columns; arrays pass straight through.
      (data as any)[k] = v;
    }
    return this.prisma.profile.update({ where: { orgId }, data });
  }
}
