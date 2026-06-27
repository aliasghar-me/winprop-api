import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

// Global rate-limit guard. Skippable via THROTTLE_DISABLED=1 so the e2e suite
// (which fires bursts of requests) isn't throttled; production leaves it unset.
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected shouldSkip(): Promise<boolean> {
    // Kill-switch is honored ONLY outside production, so it can never silently
    // disable rate limiting on a live deployment (security #10).
    return Promise.resolve(process.env.THROTTLE_DISABLED === '1' && process.env.NODE_ENV !== 'production');
  }
}
