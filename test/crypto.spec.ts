import { CryptoService } from '../src/common/crypto/crypto.service';

describe('CryptoService (AES-256-GCM)', () => {
  const key = '0'.repeat(64); // 32 bytes hex
  const svc = new CryptoService(key);

  it('round-trips a secret', () => {
    const enc = svc.encrypt('sk-secret-123');
    expect(enc).not.toContain('sk-secret-123');
    expect(svc.decrypt(enc)).toBe('sk-secret-123');
  });

  it('produces different ciphertext each call (random IV)', () => {
    expect(svc.encrypt('x')).not.toBe(svc.encrypt('x'));
  });

  it('rejects a tampered ciphertext', () => {
    const enc = svc.encrypt('x');
    const tampered = enc.slice(0, -2) + (enc.endsWith('aa') ? 'bb' : 'aa');
    expect(() => svc.decrypt(tampered)).toThrow();
  });
});
