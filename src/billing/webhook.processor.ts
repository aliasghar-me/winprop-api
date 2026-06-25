import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { BillingService } from './billing.service';

const DRAIN_INTERVAL_MS = Number(process.env.WEBHOOK_DRAIN_INTERVAL_MS ?? 30_000);

// Durability backstop for the H1 inbox. ingestEvent() kicks a fast in-request
// drain; this re-drains on startup (recover anything left mid-flight by a crash)
// and on a fixed interval (retry transient failures, pick up rows whose fast-path
// drain never ran). Disabled when WEBHOOK_DRAIN_INTERVAL_MS=0 (e.g. tests that
// drive drainPending() manually).
@Injectable()
export class WebhookProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookProcessor.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private billing: BillingService) {}

  async onModuleInit() {
    await this.tick(); // startup recovery drain
    if (DRAIN_INTERVAL_MS > 0) {
      this.timer = setInterval(() => void this.tick(), DRAIN_INTERVAL_MS);
      this.timer.unref?.(); // don't keep the event loop alive in tests/CLI
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return; // never overlap drains
    this.running = true;
    try {
      await this.billing.drainPending();
    } catch (e: any) {
      this.logger.error(`scheduled drain failed: ${e?.message ?? e}`);
    } finally {
      this.running = false;
    }
  }
}
