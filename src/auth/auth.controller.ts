import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import { ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { AuthTokenDto } from './dto/auth-token.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  private setRefresh(res: Response, token: string) {
    res.cookie('refresh', token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 3600 * 1000 });
  }

  @Post('signup')
  @ApiCreatedResponse({ type: AuthTokenDto })
  async signup(@Body() dto: SignupDto, @Res({ passthrough: true }) res: Response) {
    const t = await this.auth.signup(dto); this.setRefresh(res, t.refreshToken);
    return { accessToken: t.accessToken };
  }

  @Post('login')
  @ApiCreatedResponse({ type: AuthTokenDto })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const t = await this.auth.login(dto.email, dto.password); this.setRefresh(res, t.refreshToken);
    return { accessToken: t.accessToken };
  }

  @Post('refresh')
  @ApiCreatedResponse({ type: AuthTokenDto })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const t = await this.auth.refresh(req.cookies?.refresh); this.setRefresh(res, t.refreshToken);
    return { accessToken: t.accessToken };
  }

  // H5: hard-revoke the current refresh token server-side and clear the cookie.
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.refresh);
    res.clearCookie('refresh');
    return { ok: true };
  }
}
