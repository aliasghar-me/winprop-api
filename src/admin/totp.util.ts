import { createHmac, randomBytes } from 'crypto';

// Minimal RFC 6238 (TOTP) / RFC 4226 (HOTP) over SHA-1, implemented with Node's
// crypto so we don't add a dependency to the privileged surface. 6 digits, 30s step.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; // RFC 4648 base32
const DIGITS = 6;
const STEP_SECONDS = 30;

export function generateBase32Secret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

// otpauth URI consumed by authenticator apps (Google Authenticator, 1Password, …).
export function otpauthUrl(secret: string, account: string, issuer = 'WinProp'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const q = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${q.toString()}`;
}

// Verify a code against the current step ±`window` steps (clock-skew tolerance).
export function verifyTotp(token: string, secret: string, window = 1, now = Date.now()): boolean {
  const code = (token ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return false;
  const counter = Math.floor(now / 1000 / STEP_SECONDS);
  const key = base32Decode(secret);
  for (let i = -window; i <= window; i++) {
    if (hotp(key, counter + i) === code) return true;
  }
  return false;
}

function hotp(key: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', key).update(buf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const bin =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return (bin % 10 ** DIGITS).toString().padStart(DIGITS, '0');
}

function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str: string): Buffer {
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of str.replace(/=+$/, '').toUpperCase()) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
