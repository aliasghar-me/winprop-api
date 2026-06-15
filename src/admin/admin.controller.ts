import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
import { AdminService } from './admin.service';
import { SetLlmDto } from './dto/set-llm.dto';

@Controller('admin')
@UseGuards(SuperAdminGuard)
export class AdminController {
  constructor(private admin: AdminService) {}
  @Put('llm-config') setLlm(@Body() dto: SetLlmDto) { return this.admin.setGlobalLlm(dto); }
  @Get('llm-config') status() { return this.admin.getGlobalLlmStatus(); }
  @Get('orgs') orgs() { return this.admin.listOrgs(); }
}
