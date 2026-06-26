// Disable global rate limiting during e2e runs (the suite fires request bursts).
// The dedicated rate-limit spec re-enables it for its own app instance.
process.env.THROTTLE_DISABLED = '1';
