import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles';
import { CurrentUser } from '../auth/decorators/current-user';
import { JwtUser } from '../auth/jwt.strategy';
import { JobsService } from './jobs.service';
import { CreateJobDto } from './dto/create-job.dto';

@Controller('jobs')
@UseGuards(JwtAuthGuard, RolesGuard)
export class JobsController {
  constructor(private jobs: JobsService) {}

  @Post() @Roles('owner', 'admin', 'member')
  create(@CurrentUser() u: JwtUser, @Body() dto: CreateJobDto) {
    return this.jobs.create(u.orgId, dto.title, dto.company);
  }

  @Get()
  list(@CurrentUser() u: JwtUser) { return this.jobs.list(u.orgId); }
}
