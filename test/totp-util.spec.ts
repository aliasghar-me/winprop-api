import { generateBase32Secret, otpauthUrl, verifyTotp } from '../src/admin/totp.util';

// RFC 6238 Appendix B test vector (SHA-1):
//   secret = ASCII "12345678901234567890" = base32 "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
//   at T = 59s (counter = 1) the 8-digit TOTP is 94287082 -> 6-digit truncation "287082".
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const STEP_MS = 30_000;
const T59 = 59_000;

describe('totp.util', () => {
  describe('generateBase32Secret', () => {
    it('returns a base32 string (32 chars for the default 20 bytes)', () => {
      const s = generateBase32Secret();
      expect(s).toMatch(/^[A-Z2-7]+$/);
      expect(s).toHaveLength(32);
    });

    it('produces different secrets each call', () => {
      expect(generateBase32Secret()).not.toBe(generateBase32Secret());
    });
  });

  describe('otpauthUrl', () => {
    it('builds an otpauth URI with issuer, secret and params', () => {
      const url = otpauthUrl('ABC234', 'user@example.com');
      expect(url).toMatch(/^otpauth:\/\/totp\//);
      expect(url).toContain('secret=ABC234');
      expect(url).toContain('issuer=WinProp');
      expect(url).toContain('algorithm=SHA1');
      expect(url).toContain('digits=6');
      expect(url).toContain('period=30');
      expect(url).toContain(encodeURIComponent('WinProp:user@example.com'));
    });

    it('honours a custom issuer', () => {
      expect(otpauthUrl('S', 'a', 'Acme')).toContain('issuer=Acme');
    });
  });

  describe('verifyTotp', () => {
    it('accepts the known RFC 6238 code at the matching time step', () => {
      expect(verifyTotp('287082', SECRET, 1, T59)).toBe(true);
    });

    it('strips whitespace from the submitted token', () => {
      expect(verifyTotp('28 70 82', SECRET, 1, T59)).toBe(true);
    });

    it('accepts a code from an adjacent step within the window', () => {
      // one step later; window=1 still covers the counter that produced "287082"
      expect(verifyTotp('287082', SECRET, 1, T59 + STEP_MS)).toBe(true);
    });

    it('rejects a code that has drifted beyond the window', () => {
      expect(verifyTotp('287082', SECRET, 1, T59 + 3 * STEP_MS)).toBe(false);
    });

    it('rejects malformed tokens (not exactly 6 digits)', () => {
      expect(verifyTotp('12345', SECRET, 1, T59)).toBe(false);
      expect(verifyTotp('1234567', SECRET, 1, T59)).toBe(false);
      expect(verifyTotp('abcdef', SECRET, 1, T59)).toBe(false);
      expect(verifyTotp('', SECRET, 1, T59)).toBe(false);
    });

    it('handles a null/undefined token without throwing', () => {
      expect(verifyTotp(undefined as unknown as string, SECRET, 1, T59)).toBe(false);
    });

    it('round-trips a freshly generated secret with generate+verify semantics', () => {
      // Generate a secret and confirm a wrong code is rejected (positive path is covered
      // by the RFC vector above, which does not depend on the internal hotp helper).
      const secret = generateBase32Secret();
      expect(verifyTotp('000000', secret, 0, T59)).toBe(false);
    });
  });
});
