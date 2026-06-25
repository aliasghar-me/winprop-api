import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles';
import { CurrentUser } from '../auth/decorators/current-user';
import type { JwtUser } from '../auth/jwt.strategy';
import { JobsService } from './jobs.service';
import { CreateJobDto } from './dto/create-job.dto';
import { JobDto } from './dto/job.dto';

@ApiTags('jobs')
@ApiBearerAuth()
@Controller('jobs')
@UseGuards(JwtAuthGuard, RolesGuard)
export class JobsController {
  constructor(private jobs: JobsService) {}

  @Post() @Roles('owner', 'admin', 'member')
  @ApiCreatedResponse({ type: JobDto })
  create(@CurrentUser() u: JwtUser, @Body() dto: CreateJobDto) {
    return this.jobs.create(u.orgId, dto.title, dto.company);
  }

  @Get()
  @ApiOkResponse({ type: [JobDto] })
  list(@CurrentUser() u: JwtUser) { return this.jobs.list(u.orgId); }
}
