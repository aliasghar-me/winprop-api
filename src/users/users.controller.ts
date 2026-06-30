import { Body, Controller, Get, NotFoundException, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.js';
import type { JwtUser } from '../auth/jwt.strategy.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../common/crypto/crypto.service.js';
import { UpdateLanguageDto } from './dto/update-language.dto.js';
import { LanguageUpdatedDto } from './dto/language-updated.dto.js';
import { MeDto } from './dto/me.dto.js';

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class UsersController {
  constructor(private prisma: PrismaService, private crypto: CryptoService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Current user (incl. email-verification status)' })
  @ApiOkResponse({ type: MeDto })
  async me(@CurrentUser() user: JwtUser): Promise<MeDto> {
    const u = await this.prisma.user.findUnique({ where: { id: user.userId } });
    if (!u) throw new NotFoundException();
    // email + name are encrypted at rest — decrypt for the response.
    return { id: u.id, email: this.crypto.decryptSafe(u.email), name: this.crypto.decryptSafe(u.name), emailVerified: !!u.emailVerifiedAt };
  }

  @Patch('language')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Set preferred language for the authenticated user' })
  @ApiOkResponse({ type: LanguageUpdatedDto })
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
