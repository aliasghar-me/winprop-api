import { Injectable, Logger } from '@nestjs/common';

/**
 * Outbound email seam. No transport is wired yet (no provider credentials),
 * so in non-production we log the link and in production we warn loudly if a
 * provider hasn't been configured. Swap `deliver()` for a real SMTP/API client
 * (SES, Resend, Postmark, …) without touching callers.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  async sendVerificationEmail(to: string, verifyUrl: string): Promise<void> {
    await this.deliver({
      to,
      subject: 'Verify your WinProp email',
      text: `Confirm your email to start generating proposals:\n\n${verifyUrl}\n\nThis link expires in 24 hours.`,
    });
  }

  private async deliver(msg: { to: string; subject: string; text: string }): Promise<void> {
    // TODO: wire a real provider here using env (e.g. MAIL_PROVIDER + API key).
    if (process.env.NODE_ENV === 'production') {
      this.logger.warn(`MailService has no transport configured — email to ${msg.to} ("${msg.subject}") was NOT sent.`);
      return;
    }
    this.logger.log(`[dev mail] to=${msg.to} subject="${msg.subject}"\n${msg.text}`);
  }
}
