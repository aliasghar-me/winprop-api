// Resolve the client IP for anti-abuse tracking. Behind Caddy/Traefik the app
// trusts one proxy hop (main.ts: `trust proxy` = 1), so Express already sets
// `req.ip` to the real client. We still read the first `x-forwarded-for` hop as a
// fallback for environments where trust-proxy isn't wired. Never used raw in the
// DB — it is hashed before storage.
export function clientIp(req: { ip?: string; headers?: Record<string, unknown>; socket?: { remoteAddress?: string } }): string {
  const xff = req.headers?.['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim().length > 0) {
    return xff.split(',')[0].trim();
  }
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}
