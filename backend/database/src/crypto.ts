/**
 * Aadhaar protection (SRS R15 / NFR-4: "encrypt Aadhaar and personal data at rest").
 *
 *  - aadhaar_enc  : AES-256-GCM ciphertext  "v1:<iv>:<tag>:<ciphertext>" (base64 parts)
 *  - aadhaar_hash : HMAC-SHA256(pepper, aadhaar) hex — lets us detect duplicate
 *                   registrations without ever decrypting (FR-1 "check for duplicate")
 *  - aadhaar_last4: the only part ever displayed ("XXXX XXXX 1234")
 *
 * Keys live only in the API's environment, never in the database.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { isValidAadhaar, normalizeAadhaar } from '@srms/shared';

const VERSION = 'v1';

function encKey(): Buffer {
  const b64 = process.env.AADHAAR_ENC_KEY;
  if (!b64) throw new Error('AADHAAR_ENC_KEY is not set');
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) throw new Error('AADHAAR_ENC_KEY must be 32 bytes, base64-encoded');
  return key;
}

function pepper(): string {
  const p = process.env.AADHAAR_HASH_PEPPER;
  if (!p || p.length < 16) throw new Error('AADHAAR_HASH_PEPPER must be set (16+ characters)');
  return p;
}

export function encryptAadhaar(aadhaar: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encKey(), iv);
  const ct = Buffer.concat([cipher.update(aadhaar, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

export function decryptAadhaar(payload: string): string {
  const [version, ivB64, tagB64, ctB64] = payload.split(':');
  if (version !== VERSION || !ivB64 || !tagB64 || !ctB64) {
    throw new Error('Unsupported Aadhaar ciphertext format');
  }
  const decipher = createDecipheriv('aes-256-gcm', encKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export function hashAadhaar(aadhaar: string): string {
  return createHmac('sha256', pepper()).update(normalizeAadhaar(aadhaar)).digest('hex');
}

export interface ProtectedAadhaar {
  aadhaarEnc: string;
  aadhaarHash: string;
  aadhaarLast4: string;
}

/** Validate (format + Verhoeff checksum) and produce the three stored columns. */
export function protectAadhaar(raw: string): ProtectedAadhaar {
  const aadhaar = normalizeAadhaar(raw);
  if (!isValidAadhaar(aadhaar)) throw new Error('Invalid Aadhaar number');
  return {
    aadhaarEnc: encryptAadhaar(aadhaar),
    aadhaarHash: hashAadhaar(aadhaar),
    aadhaarLast4: aadhaar.slice(-4),
  };
}
