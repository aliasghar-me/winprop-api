import { Body, Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { EmailVerificationService } from './email-verification.service';
import { TrialCheckoutService } from './trial-checkout.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user';
import type { JwtUser } from './jwt.strategy';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ClaimTrialDto } from './dto/claim-trial.dto';
import { SetPasswordDto } from './dto/set-password.dto';
import { AuthTokenDto } from './dto/auth-token.dto';
import { ClaimTrialResultDto } from './dto/claim-trial-result.dto';
import { AppException } from '../common/errors/app-exception';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private auth: AuthService,
    private emailVerification: EmailVerificationService,
    private trialCheckout: TrialCheckoutService,
  ) {}

  private refreshCookieOptions(): { httpOnly: true; sameSite: 'none' | 'lax' | 'strict'; secure: boolean } {
    const sameSite = (process.env.AUTH_COOKIE_SAMESITE ?? 'none') as 'none' | 'lax' | 'strict';
    const secure = sameSite === 'none' ? true : process.env.NODE_ENV === 'production';
    return { httpOnly: true, sameSite, secure };
  }

  private setRefresh(res: Response, token: string) {
    res.cookie('refresh', token, { ...this.refreshCookieOptions(), maxAge: 7 * 24 * 3600 * 1000 });
  }

  // CSRF defense-in-depth for the cookie-driven endpoints: if a browser sends an
  // Origin, it must be an allowed one. Absent Origin (server-to-server / tests) is allowed.
  private assertOrigin(req: Request) {
    const origin = req.headers.origin;
    if (!origin) return;
    const allowed = process.env.WEB_ORIGIN?.split(',') ?? [];
    if (!allowed.includes(origin)) throw new AppException(403, 'FORBIDDEN', 'errors.invalidOrigin');
  }

  @Post('signup')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiCreatedResponse({ type: AuthTokenDto })
  async signup(@Body() dto: SignupDto, @Res({ passthrough: true }) res: Response) {
    const t = await this.auth.signup(dto); this.setRefresh(res, t.refreshToken);
    return { accessToken: t.accessToken };
  }

  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiCreatedResponse({ type: AuthTokenDto })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const t = await this.auth.login(dto.email, dto.password); this.setRefresh(res, t.refreshToken);
    return { accessToken: t.accessToken };
  }

  @Post('refresh')
  @ApiCreatedResponse({ type: AuthTokenDto })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.assertOrigin(req);
    const t = await this.auth.refresh(req.cookies?.refresh); this.setRefresh(res, t.refreshToken);
    return { accessToken: t.accessToken };
  }

  // H5: hard-revoke the current refresh token server-side and clear the cookie.
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.assertOrigin(req);
    await this.auth.logout(req.cookies?.refresh);
    res.clearCookie('refresh', this.refreshCookieOptions());
    return { ok: true };
  }

  // "Logout everywhere" — revoke all of the caller's refresh tokens.
  @Post('logout-all') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  async logoutAll(@CurrentUser() u: JwtUser, @Res({ passthrough: true }) res: Response) {
    await this.auth.revokeAllForUser(u.userId);
    res.clearCookie('refresh', this.refreshCookieOptions());
    return { ok: true };
  }

  // Card-first trial: verify a completed Stripe Checkout, then auto-provision +
  // auto-login (idempotent). Sets the same httpOnly refresh cookie as signup/login.
  @Post('claim-trial')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiCreatedResponse({ type: ClaimTrialResultDto })
  async claimTrial(@Body() dto: ClaimTrialDto, @Res({ passthrough: true }) res: Response) {
    const { tokens, needsOnboarding } = await this.trialCheckout.claimTrial(dto.sessionId);
    this.setRefresh(res, tokens.refreshToken);
    return { accessToken: tokens.accessToken, needsOnboarding };
  }

  // Onboarding "set your password" — lets an auto-provisioned trial user pick a real
  // password so they can log back in later. Authenticated (uses the trial session).
  @Post('set-password') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  setPassword(@CurrentUser() u: JwtUser, @Body() dto: SetPasswordDto) {
    return this.auth.setPassword(u.userId, dto.password);
  }

  // Confirm an email address from the link token (public — the user may be logged out).
  @Post('verify-email')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.emailVerification.verify(dto.token);
  }

  // Re-send the verification link to the authenticated (still-unverified) user.
  @Post('resend-verification') @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  resendVerification(@CurrentUser() u: JwtUser) {
    return this.emailVerification.resend(u.userId);
  }
}
