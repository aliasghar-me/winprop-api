import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

// Global rate-limit guard. Skippable via THROTTLE_DISABLED=1 so the e2e suite
// (which fires bursts of requests) isn't throttled; production leaves it unset.
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected shouldSkip(): Promise<boolean> {
    return Promise.resolve(process.env.THROTTLE_DISABLED === '1');
  }
}
