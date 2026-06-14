import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { SignupDto } from './dto/signup.dto';
import { AppException } from '../common/errors/app-exception';

const PROFESSION_DEFAULTS: Record<string, { services: string[]; skills: string[] }> = {
  developer: { services: ['SaaS Platforms', 'Backend Architecture'], skills: ['Next.js', 'NestJS', 'PostgreSQL'] },
  designer: { services: ['Brand identity', 'UI/UX design'], skills: ['Figma', 'Framer'] },
  writer: { services: ['Content strategy', 'Copywriting'], skills: ['Long-form', 'SEO'] },
  sales: { services: ['Sales consulting', 'GTM strategy'], skills: ['SaaS', 'Outbound'] },
  marketer: { services: ['Growth marketing', 'Campaign strategy'], skills: ['Paid social', 'Email'] },
  consultant: { services: ['Advisory', 'Diagnostics'], skills: ['Strategy', 'Operations'] },
  video: { services: ['Brand films', 'Motion graphics'], skills: ['Direction', 'Editing'] },
};

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  async signup(dto: SignupDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new AppException(400, 'VALIDATION', 'Email already in use.');
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const defs = PROFESSION_DEFAULTS[dto.profession];

    const { user, org, membership } = await this.prisma.$transaction(async (tx: any) => {
      const user = await tx.user.create({ data: { email: dto.email, passwordHash, name: dto.name } });
      const org = await tx.org.create({ data: { name: dto.agencyName, profession: dto.profession } });
      const membership = await tx.membership.create({ data: { userId: user.id, orgId: org.id, role: 'owner' } });
      await tx.profile.create({ data: { orgId: org.id, agencyName: dto.agencyName, services: defs.services, skills: defs.skills } });
      return { user, org, membership };
    });
    return this.issueTokens(user.id, org.id, membership.role);
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email }, include: { memberships: true } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash)))
      throw new AppException(401, 'UNAUTHORIZED', 'Invalid email or password.');
    const m = user.memberships[0];
    return this.issueTokens(user.id, m.orgId, m.role);
  }

  issueTokens(userId: string, orgId: string, role: string) {
    const accessToken = this.jwt.sign({ sub: userId, orgId, role }, { expiresIn: '10m' });
    const refreshToken = this.jwt.sign({ sub: userId, orgId, role, typ: 'refresh' }, { expiresIn: '7d' });
    return { accessToken, refreshToken };
  }
}
