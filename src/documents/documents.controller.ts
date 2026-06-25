import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles';
import { CurrentUser } from '../auth/decorators/current-user';
import type { JwtUser } from '../auth/jwt.strategy';
import { QuotaGuard } from './quota.guard';
import { DocumentsService } from './documents.service';
import { DocumentDto } from './dto/document.dto';

@ApiTags('documents')
@ApiBearerAuth()
@Controller('jobs/:jobId/documents')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DocumentsController {
  constructor(private docs: DocumentsService) {}

  @Post() @Roles('owner', 'admin', 'member') @UseGuards(QuotaGuard)
  @ApiCreatedResponse({ type: DocumentDto })
  generate(@CurrentUser() u: JwtUser, @Param('jobId') jobId: string, @Req() req: Request) {
    return this.docs.generateProposal(u.orgId, jobId, (req as any).quotaReservation);
  }

  @Get(':docId')
  @ApiOkResponse({ type: DocumentDto })
  getOne(@CurrentUser() u: JwtUser, @Param('jobId') jobId: string, @Param('docId') docId: string) {
    return this.docs.getOne(u.orgId, jobId, docId);
  }
}
