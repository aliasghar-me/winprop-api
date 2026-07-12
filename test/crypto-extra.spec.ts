import { CryptoService } from '../src/common/crypto/crypto.service';

const KEY = '00'.repeat(32); // 64 hex chars = 32 bytes

describe('CryptoService (extra coverage)', () => {
  const svc = new CryptoService(KEY);

  describe('constructor', () => {
    it('throws when the key is not 64 hex chars', () => {
      expect(() => new CryptoService('tooshort')).toThrow('ENCRYPTION_KEY must be 64 hex chars (32 bytes)');
      expect(() => new CryptoService('')).toThrow();
    });

    it('reads ENCRYPTION_KEY from the environment when no arg passed', () => {
      const prev = process.env.ENCRYPTION_KEY;
      process.env.ENCRYPTION_KEY = KEY;
      try {
        const envSvc = new CryptoService();
        expect(envSvc.decrypt(envSvc.encrypt('hi'))).toBe('hi');
      } finally {
        process.env.ENCRYPTION_KEY = prev;
      }
    });
  });

  describe('hmac', () => {
    it('is deterministic for the same input', () => {
      expect(svc.hmac('user@example.com')).toBe(svc.hmac('user@example.com'));
    });

    it('differs for different inputs and is a 64-char hex sha256 digest', () => {
      const a = svc.hmac('a');
      const b = svc.hmac('b');
      expect(a).not.toBe(b);
      expect(a).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('decryptSafe', () => {
    it('returns empty string for null/undefined/empty', () => {
      expect(svc.decryptSafe(null)).toBe('');
      expect(svc.decryptSafe(undefined)).toBe('');
      expect(svc.decryptSafe('')).toBe('');
    });

    it('passes through plaintext that is not in our ciphertext shape', () => {
      expect(svc.decryptSafe('plain-legacy-value')).toBe('plain-legacy-value');
    });

    it('decrypts a value that is our ciphertext', () => {
      const enc = svc.encrypt('real-secret');
      expect(svc.decryptSafe(enc)).toBe('real-secret');
    });

    it('returns the input unchanged when it looks like ciphertext but cannot be decrypted', () => {
      const bogus = 'aa:bb:cc'; // matches shape, fails GCM decrypt
      expect(svc.decryptSafe(bogus)).toBe(bogus);
    });
  });
});
