import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

@Injectable()
export class CryptoService {
  private readonly key: Buffer;
  constructor(keyHex = process.env.ENCRYPTION_KEY!) {
    if (!keyHex || keyHex.length !== 64) throw new Error('ENCRYPTION_KEY must be 64 hex chars (32 bytes)');
    this.key = Buffer.from(keyHex, 'hex');
  }
  encrypt(plain: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv.toString('hex'), tag.toString('hex'), enc.toString('hex')].join(':');
  }
  decrypt(payload: string): string {
    const [ivHex, tagHex, dataHex] = payload.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
  }

  // Deterministic keyed hash for blind-index lookups (e.g. find a user by email
  // without storing the email in cleartext). Same input → same output, so it can
  // back a UNIQUE column; not reversible.
  hmac(value: string): string {
    return crypto.createHmac('sha256', this.key).update(value).digest('hex');
  }

  // Tolerant decrypt for the plaintext→ciphertext transition: values written
  // before field-encryption (or by a backfill that hasn't run) are returned as-is.
  decryptSafe(value: string | null | undefined): string {
    if (!value) return '';
    if (!/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i.test(value)) return value; // not our ciphertext shape
    try { return this.decrypt(value); } catch { return value; }
  }
}
