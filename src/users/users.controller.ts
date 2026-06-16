import { Body, Controller, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.js';
import type { JwtUser } from '../auth/jwt.strategy.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UpdateLanguageDto } from './dto/update-language.dto.js';

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class UsersController {
  constructor(private prisma: PrismaService) {}

  @Patch('language')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Set preferred language for the authenticated user' })
  async setLanguage(
    @CurrentUser() user: JwtUser,
    @Body() dto: UpdateLanguageDto,
  ) {
    await this.prisma.user.update({
      where: { id: user.userId },
      data: { preferredLanguage: dto.language },
    });
    return { ok: true, language: dto.language };
  }
}
