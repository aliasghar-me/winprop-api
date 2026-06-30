import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

/**
 * Outbound email. Uses Resend when RESEND_API_KEY + MAIL_FROM are configured;
 * otherwise logs in dev and warns in prod (so a missing provider is loud, not silent).
 * `deliver()` is the single seam — swap the transport without touching callers.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private client: Resend | null = null;

  private resend(): Resend | null {
    if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) return null;
    if (!this.client) this.client = new Resend(process.env.RESEND_API_KEY);
    return this.client;
  }

  async sendVerificationEmail(to: string, verifyUrl: string): Promise<void> {
    await this.deliver({
      to,
      subject: 'Verify your WinProp email',
      text: `Confirm your email to start generating proposals:\n\n${verifyUrl}\n\nThis link expires in 24 hours.`,
    });
  }

  private async deliver(msg: { to: string; subject: string; text: string }): Promise<void> {
    const resend = this.resend();
    if (resend) {
      try {
        const { error } = await resend.emails.send({
          from: process.env.MAIL_FROM as string,
          to: msg.to,
          subject: msg.subject,
          text: msg.text,
        });
        if (error) this.logger.error(`Mail send failed to ${msg.to}: ${error.message ?? error}`);
        return;
      } catch (e: unknown) {
        // Never let a mail failure break the calling flow (callers already treat it as non-fatal).
        this.logger.error(`Mail transport error to ${msg.to}: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
    }
    if (process.env.NODE_ENV === 'production') {
      this.logger.warn(`No mail transport configured (set RESEND_API_KEY + MAIL_FROM) — email to ${msg.to} ("${msg.subject}") was NOT sent.`);
      return;
    }
    this.logger.log(`[dev mail] to=${msg.to} subject="${msg.subject}"\n${msg.text}`);
  }
}
