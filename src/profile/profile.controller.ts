import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantGuard } from '../common/tenant/tenant.guard';
import { Roles } from '../auth/decorators/roles';
import { CurrentUser } from '../auth/decorators/current-user';
import type { JwtUser } from '../auth/jwt.strategy';
import { ProfileService } from './profile.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfileDto } from './dto/profile.dto';

@ApiTags('profile')
@ApiBearerAuth()
@Controller('profile')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class ProfileController {
  constructor(private profile: ProfileService) {}

  @Get()
  @ApiOkResponse({ type: ProfileDto })
  get(@CurrentUser() u: JwtUser) { return this.profile.get(u.orgId); }

  @Patch() @Roles('owner', 'admin')
  @ApiOkResponse({ type: ProfileDto })
  update(@CurrentUser() u: JwtUser, @Body() dto: UpdateProfileDto) {
    return this.profile.update(u.orgId, dto);
  }
}
