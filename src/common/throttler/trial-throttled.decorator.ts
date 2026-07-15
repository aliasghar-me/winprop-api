import { SetMetadata } from '@nestjs/common';

// Marks a route as belonging to the anonymous free-trial funnel. The strict
// per-IP / per-fingerprint throttlers (configured in app.module) enforce ONLY on
// routes carrying this flag — their `skipIf` skips everything else — so the strict
// anon limits never touch authenticated app routes.
export const TRIAL_THROTTLED_KEY = 'trial:throttled';
export const TrialThrottled = () => SetMetadata(TRIAL_THROTTLED_KEY, true);
