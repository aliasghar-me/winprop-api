import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles';
import { CurrentUser } from '../auth/decorators/current-user';
import type { JwtUser } from '../auth/jwt.strategy';
import { QuotaGuard } from './quota.guard';
import { DocumentsService } from './documents.service';

@Controller('jobs/:jobId/documents')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DocumentsController {
  constructor(private docs: DocumentsService) {}

  @Post() @Roles('owner', 'admin', 'member') @UseGuards(QuotaGuard)
  generate(@CurrentUser() u: JwtUser, @Param('jobId') jobId: string) {
    return this.docs.generateProposal(u.orgId, jobId);
  }

  @Get(':docId')
  getOne(@CurrentUser() u: JwtUser, @Param('jobId') jobId: string, @Param('docId') docId: string) {
    return this.docs.getOne(u.orgId, jobId, docId);
  }
}
