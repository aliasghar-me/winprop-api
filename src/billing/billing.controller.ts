import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user';
import { JwtUser } from '../auth/jwt.strategy';
import { BillingService } from './billing.service';
import { CheckoutDto } from './dto/checkout.dto';

@Controller('billing')
export class BillingController {
  constructor(private billing: BillingService) {}
  @Post('checkout') @UseGuards(JwtAuthGuard)
  checkout(@CurrentUser() u: JwtUser, @Body() dto: CheckoutDto) {
    return this.billing.createCheckout(u.orgId, dto.plan);
  }
}
