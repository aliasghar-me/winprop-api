import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles';
import { CurrentUser } from '../auth/decorators/current-user';
import type { JwtUser } from '../auth/jwt.strategy';
import { QuotaGuard } from './quota.guard';
import { EmailVerifiedGuard } from '../auth/guards/email-verified.guard';
import { DocumentsService } from './documents.service';
import { DocumentDto } from './dto/document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { RegenerateSectionDto } from './dto/regenerate-section.dto';
import { AdjustToneDto } from './dto/adjust-tone.dto';

@ApiTags('documents')
@ApiBearerAuth()
@Controller('jobs/:jobId/documents')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DocumentsController {
  constructor(private docs: DocumentsService) {}

  @Post() @Roles('owner', 'admin', 'member') @UseGuards(EmailVerifiedGuard, QuotaGuard)
  @ApiCreatedResponse({ type: DocumentDto })
  generate(@CurrentUser() u: JwtUser, @Param('jobId') jobId: string, @Req() req: Request) {
    return this.docs.generateProposal(u.orgId, jobId, (req as any).quotaReservation);
  }

  @Get(':docId')
  @ApiOkResponse({ type: DocumentDto })
  getOne(@CurrentUser() u: JwtUser, @Param('jobId') jobId: string, @Param('docId') docId: string) {
    return this.docs.getOne(u.orgId, jobId, docId);
  }

  // Editor save (autosave). Content edits snapshot the prior version.
  @Patch(':docId') @Roles('owner', 'admin', 'member')
  @ApiOkResponse({ type: DocumentDto })
  update(@CurrentUser() u: JwtUser, @Param('jobId') jobId: string, @Param('docId') docId: string, @Body() dto: UpdateDocumentDto) {
    return this.docs.update(u.orgId, jobId, docId, dto);
  }

  @Get(':docId/versions')
  @ApiOkResponse({ type: [DocumentDto] })
  versions(@CurrentUser() u: JwtUser, @Param('jobId') jobId: string, @Param('docId') docId: string) {
    return this.docs.listVersions(u.orgId, jobId, docId);
  }

  // Create / revoke the public share link.
  @Post(':docId/share') @Roles('owner', 'admin', 'member')
  share(@CurrentUser() u: JwtUser, @Param('jobId') jobId: string, @Param('docId') docId: string) {
    return this.docs.share(u.orgId, jobId, docId);
  }

  @Delete(':docId/share') @Roles('owner', 'admin', 'member')
  unshare(@CurrentUser() u: JwtUser, @Param('jobId') jobId: string, @Param('docId') docId: string) {
    return this.docs.unshare(u.orgId, jobId, docId);
  }

  // Per-section AI regenerate — quota-gated (each AI call consumes one slot).
  @Post(':docId/regenerate-section') @Roles('owner', 'admin', 'member') @UseGuards(EmailVerifiedGuard, QuotaGuard)
  regenerateSection(
    @CurrentUser() u: JwtUser,
    @Param('jobId') jobId: string,
    @Param('docId') docId: string,
    @Body() dto: RegenerateSectionDto,
    @Req() req: Request,
  ) {
    return this.docs.regenerateSection(u.orgId, jobId, docId, dto.section, (req as any).quotaReservation);
  }

  // Adjust tone — re-runs the prose sections in a new tone, saves a labeled version.
  @Post(':docId/adjust-tone') @Roles('owner', 'admin', 'member') @UseGuards(EmailVerifiedGuard, QuotaGuard)
  @ApiOkResponse({ type: DocumentDto })
  adjustTone(
    @CurrentUser() u: JwtUser,
    @Param('jobId') jobId: string,
    @Param('docId') docId: string,
    @Body() dto: AdjustToneDto,
    @Req() req: Request,
  ) {
    return this.docs.adjustTone(u.orgId, jobId, docId, dto.tone, (req as any).quotaReservation);
  }

  // Adjust pricing — re-runs the price within the agency's range, saves a labeled version.
  @Post(':docId/adjust-pricing') @Roles('owner', 'admin', 'member') @UseGuards(EmailVerifiedGuard, QuotaGuard)
  @ApiOkResponse({ type: DocumentDto })
  adjustPricing(
    @CurrentUser() u: JwtUser,
    @Param('jobId') jobId: string,
    @Param('docId') docId: string,
    @Req() req: Request,
  ) {
    return this.docs.adjustPricing(u.orgId, jobId, docId, (req as any).quotaReservation);
  }
}
