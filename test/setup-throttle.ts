// Disable global rate limiting during e2e runs (the suite fires request bursts).
// The dedicated rate-limit spec re-enables it for its own app instance.
process.env.THROTTLE_DISABLED = '1';

// Email-verification gate off by default so generation specs don't each need to
// verify first. The dedicated email-verification spec turns it on for itself.
process.env.EMAIL_VERIFICATION_REQUIRED = 'false';

// Keep auth-cookie behavior deterministic: tests assert the code default
// (sameSite: 'none', secure: true). A developer's local .env (loaded via
// dotenv/config in the coverage config) must not leak in and flip it to 'lax'.
delete process.env.AUTH_COOKIE_SAMESITE;
