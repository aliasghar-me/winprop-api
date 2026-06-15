import { Body, Controller, Headers, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user';
import type { JwtUser } from '../auth/jwt.strategy';
import { BillingService } from './billing.service';
import { CheckoutDto } from './dto/checkout.dto';

@Controller('billing')
export class BillingController {
  constructor(private billing: BillingService) {}

  @Post('checkout') @UseGuards(JwtAuthGuard)
  checkout(@CurrentUser() u: JwtUser, @Body() dto: CheckoutDto) {
    return this.billing.createCheckout(u.orgId, dto.plan);
  }

  @Post('webhook') @HttpCode(200)
  webhook(@Req() req: Request & { rawBody?: Buffer }, @Headers('stripe-signature') sig: string) {
    return this.billing.handleEvent(req.rawBody ?? (req as any).body, sig);
  }
}
