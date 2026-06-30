import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiTags, ApiOkResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantGuard } from '../common/tenant/tenant.guard';
import { CurrentUser } from '../auth/decorators/current-user';
import type { JwtUser } from '../auth/jwt.strategy';
import { ExportService } from './export.service';

@ApiTags('documents')
@ApiBearerAuth()
@Controller('jobs/:jobId/documents/:docId')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class ExportController {
  constructor(private exportSvc: ExportService) {}

  // Server-rendered branded PDF of a proposal (tenant-scoped).
  @Get('pdf')
  @ApiOkResponse({ description: 'Branded proposal PDF (application/pdf).' })
  async pdf(
    @CurrentUser() u: JwtUser,
    @Param('jobId') jobId: string,
    @Param('docId') docId: string,
    @Res() res: Response,
  ) {
    const pdf = await this.exportSvc.renderProposalPdf(u.orgId, jobId, docId);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="proposal-${docId}.pdf"` });
    res.send(pdf);
  }
}
