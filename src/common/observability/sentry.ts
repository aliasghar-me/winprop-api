import * as Sentry from '@sentry/node';

// Initialize Sentry only when a DSN is configured — otherwise a no-op so dev/CI
// and unconfigured prod don't emit. captureException is always safe to call.
export function initSentry(): void {
  if (!process.env.SENTRY_DSN) return;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
  });
}

export function captureException(err: unknown): void {
  if (!process.env.SENTRY_DSN) return;
  Sentry.captureException(err);
}
