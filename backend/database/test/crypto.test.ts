import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isValidAadhaar, makeAadhaar } from '@srms/shared';

process.env.AADHAAR_ENC_KEY ??= randomBytes(32).toString('base64');
process.env.AADHAAR_HASH_PEPPER ??= 'test-pepper-0123456789';

const { decryptAadhaar, encryptAadhaar, hashAadhaar, protectAadhaar } = await import('../src/crypto');
const { hashPassword, verifyPassword, passwordProblems } = await import('../src/password');

describe('Aadhaar format (Verhoeff checksum)', () => {
  it('accepts checksummed numbers and rejects typos', () => {
    const a = makeAadhaar('23456789012');
    expect(isValidAadhaar(a)).toBe(true);
    expect(isValidAadhaar(`${a.slice(0, 11)}${(Number(a[11]) + 1) % 10}`)).toBe(false); // wrong check digit
    expect(isValidAadhaar(`${a.slice(0, 5)}${a[6]}${a[5]}${a.slice(7)}`)).toBe(false); // transposition
    expect(isValidAadhaar('123456789012')).toBe(false); // cannot start with 1
    expect(isValidAadhaar(`${a.slice(0, 4)} ${a.slice(4, 8)} ${a.slice(8)}`)).toBe(true); // spaces ok
  });
});

describe('Aadhaar encryption at rest', () => {
  it('round-trips, uses a fresh IV each time, and detects tampering', () => {
    const a = makeAadhaar('98765432109');
    const c1 = encryptAadhaar(a);
    const c2 = encryptAadhaar(a);
    expect(c1).not.toBe(c2);
    expect(decryptAadhaar(c1)).toBe(a);
    const parts = c1.split(':');
    parts[3] = Buffer.from('000000000000').toString('base64');
    expect(() => decryptAadhaar(parts.join(':'))).toThrow();
  });

  it('hashes deterministically for duplicate detection and exposes only the last 4 digits', () => {
    const a = makeAadhaar('34567890123');
    expect(hashAadhaar(a)).toBe(hashAadhaar(a));
    const p = protectAadhaar(a);
    expect(p.aadhaarLast4).toBe(a.slice(-4));
    expect(p.aadhaarEnc).not.toContain(a);
    expect(() => protectAadhaar('234567890123')).toThrow();
  });
});

describe('staff passwords', () => {
  it('hashes with scrypt and verifies', async () => {
    const h = await hashPassword('Correct-Horse-9');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('Correct-Horse-9', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
    expect(passwordProblems('short')).not.toHaveLength(0);
    expect(passwordProblems('LongEnough123')).toHaveLength(0);
  });
});
