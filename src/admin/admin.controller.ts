import { Body, Controller, Get, Post, Put, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
import { AdminService } from './admin.service';
import { SuperAdminService } from './super-admin.service';
import { SuperAdminAuditInterceptor } from './super-admin-audit.interceptor';
import { SetLlmDto } from './dto/set-llm.dto';
import { OkDto } from './dto/ok.dto';
import { LlmStatusDto } from './dto/llm-status.dto';
import { OrgSummaryDto } from './dto/org-summary.dto';
import { SuperAdminLoginDto, SuperAdminTokenDto } from './dto/super-admin-login.dto';

@ApiTags('admin')
@Controller('admin')
export class AdminController {
  constructor(private admin: AdminService, private superAdmin: SuperAdminService) {}

  // Public: exchange super-admin credentials for a short-lived scoped token.
  // Tight limit — brute-force protection on the privileged surface (H3 follow-up).
  @Post('login') @Throttle({ default: { limit: 5, ttl: 60_000 } }) @ApiCreatedResponse({ type: SuperAdminTokenDto })
  login(@Body() dto: SuperAdminLoginDto) { return this.superAdmin.login(dto.email, dto.password); }

  // Everything below requires the super-admin JWT and is audit-logged.
  @Put('llm-config') @UseGuards(SuperAdminGuard) @UseInterceptors(SuperAdminAuditInterceptor) @ApiBearerAuth() @ApiOkResponse({ type: OkDto })
  setLlm(@Body() dto: SetLlmDto) { return this.admin.setGlobalLlm(dto); }

  @Get('llm-config') @UseGuards(SuperAdminGuard) @UseInterceptors(SuperAdminAuditInterceptor) @ApiBearerAuth() @ApiOkResponse({ type: LlmStatusDto })
  status() { return this.admin.getGlobalLlmStatus(); }

  @Get('orgs') @UseGuards(SuperAdminGuard) @UseInterceptors(SuperAdminAuditInterceptor) @ApiBearerAuth() @ApiOkResponse({ type: [OrgSummaryDto] })
  orgs() { return this.admin.listOrgs(); }
}
