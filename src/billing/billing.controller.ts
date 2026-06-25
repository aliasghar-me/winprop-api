import { Body, Controller, Headers, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiAcceptedResponse, ApiBearerAuth, ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user';
import type { JwtUser } from '../auth/jwt.strategy';
import { BillingService } from './billing.service';
import { CheckoutDto } from './dto/checkout.dto';
import { CheckoutSessionDto } from './dto/checkout-session.dto';
import { WebhookReceivedDto } from './dto/webhook-received.dto';

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(private billing: BillingService) {}

  @Post('checkout') @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiCreatedResponse({ type: CheckoutSessionDto })
  checkout(@CurrentUser() u: JwtUser, @Body() dto: CheckoutDto) {
    return this.billing.createCheckout(u.orgId, dto.plan);
  }

  // 202 Accepted: the event is durably queued and will be processed off the
  // request path (H1). Stripe treats any 2xx as a successful delivery.
  @Post('webhook') @HttpCode(202)
  @ApiAcceptedResponse({ type: WebhookReceivedDto })
  webhook(@Req() req: Request & { rawBody?: Buffer }, @Headers('stripe-signature') sig: string) {
    return this.billing.ingestEvent(req.rawBody ?? (req as any).body, sig);
  }
}
