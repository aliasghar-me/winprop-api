import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { EmailVerificationService } from './email-verification.service';
import { TrialCheckoutService } from './trial-checkout.service';
import { MailModule } from '../mail/mail.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [
    PassportModule,
    MailModule,
    // For STRIPE_CLIENT (used by the card-first trial-checkout flow). One-way import
    // (Billing does not import Auth) so there is no module cycle.
    BillingModule,
    JwtModule.registerAsync({ useFactory: () => ({ secret: process.env.JWT_SECRET, signOptions: { algorithm: 'HS256' } }) }),
  ],
  providers: [AuthService, JwtStrategy, EmailVerificationService, TrialCheckoutService],
  controllers: [AuthController],
  exports: [AuthService, JwtModule, TrialCheckoutService],
})
export class AuthModule {}
