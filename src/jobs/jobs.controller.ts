import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles';
import { CurrentUser } from '../auth/decorators/current-user';
import type { JwtUser } from '../auth/jwt.strategy';
import { QuotaGuard } from '../documents/quota.guard';
import { EmailVerifiedGuard } from '../auth/guards/email-verified.guard';
import { TenantGuard } from '../common/tenant/tenant.guard';
import { JobsService } from './jobs.service';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { JobDto } from './dto/job.dto';

@ApiTags('jobs')
@ApiBearerAuth()
@Controller('jobs')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class JobsController {
  constructor(private jobs: JobsService) {}

  @Post() @Roles('owner', 'admin', 'member')
  @ApiCreatedResponse({ type: JobDto })
  create(@CurrentUser() u: JwtUser, @Body() dto: CreateJobDto) {
    return this.jobs.create(u.orgId, dto);
  }

  @Get()
  @ApiOkResponse({ type: [JobDto] })
  list(@CurrentUser() u: JwtUser) { return this.jobs.list(u.orgId); }

  @Get(':id')
  @ApiOkResponse({ type: JobDto })
  getOne(@CurrentUser() u: JwtUser, @Param('id') id: string) { return this.jobs.getOwned(u.orgId, id); }

  // Quota-gated: analysis is a paid LLM call, so it consumes one slot like
  // proposal generation/regeneration (QuotaGuard reserves up-front; the service
  // releases the reservation if the call fails).
  @Post(':id/intelligence') @Roles('owner', 'admin', 'member') @UseGuards(EmailVerifiedGuard, QuotaGuard)
  @ApiOkResponse({ description: 'AI Job-Intelligence analysis (objective, stack, risks, clarification questions, win-probability).' })
  analyze(@CurrentUser() u: JwtUser, @Param('id') id: string, @Req() req: Request) {
    return this.jobs.analyze(u.orgId, id, (req as any).quotaReservation);
  }

  @Patch(':id') @Roles('owner', 'admin', 'member')
  @ApiOkResponse({ type: JobDto })
  update(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() dto: UpdateJobDto) {
    return this.jobs.update(u.orgId, id, dto);
  }
}
