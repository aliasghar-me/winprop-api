import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles';
import { CurrentUser } from '../auth/decorators/current-user';
import type { JwtUser } from '../auth/jwt.strategy';
import { TenantGuard } from '../common/tenant/tenant.guard';
import { MemoryService } from './memory.service';
import { CreateMemoryDto } from './dto/create-memory.dto';
import { UpdateMemoryDto } from './dto/update-memory.dto';

@ApiTags('memory')
@ApiBearerAuth()
@Controller('memory')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class MemoryController {
  constructor(private memory: MemoryService) {}

  @Get()
  @ApiOkResponse({ description: 'All non-deleted memory facts for the org, ordered by category then key.' })
  list(@CurrentUser() u: JwtUser) {
    return this.memory.list(u.orgId);
  }

  @Get('categories')
  @ApiOkResponse({ description: 'Distinct categories with a count of facts in each.' })
  categories(@CurrentUser() u: JwtUser) {
    return this.memory.categories(u.orgId);
  }

  @Get('export')
  @ApiOkResponse({ description: 'Portable dump of the org memory (sensitive values decrypted).' })
  export(@CurrentUser() u: JwtUser) {
    return this.memory.export(u.orgId);
  }

  @Post() @Roles('owner', 'admin', 'member')
  @ApiOkResponse({ description: 'Create or upsert a memory fact by (category, key).' })
  create(@CurrentUser() u: JwtUser, @Body() dto: CreateMemoryDto) {
    return this.memory.create(u.orgId, dto);
  }

  @Patch(':id') @Roles('owner', 'admin', 'member')
  @ApiOkResponse({ description: 'Update a memory fact.' })
  update(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() dto: UpdateMemoryDto) {
    return this.memory.update(u.orgId, id, dto);
  }

  @Delete(':id') @Roles('owner', 'admin', 'member')
  @ApiOkResponse({ description: 'Soft-delete a single memory fact.' })
  remove(@CurrentUser() u: JwtUser, @Param('id') id: string) {
    return this.memory.remove(u.orgId, id);
  }

  @Delete() @Roles('owner', 'admin', 'member')
  @ApiOkResponse({ description: 'Soft-delete all memory facts, or only those in ?category=.' })
  removeMany(@CurrentUser() u: JwtUser, @Query('category') category?: string) {
    return this.memory.removeMany(u.orgId, category);
  }
}
