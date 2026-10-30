/**
 * Aadhaar number helpers (FR-1: "validate Aadhaar number format").
 * An Aadhaar number is 12 digits, never starts with 0 or 1, and its last
 * digit is a Verhoeff checksum over the first 11.
 */

// Verhoeff dihedral-group multiplication table
const D: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

// Verhoeff permutation table
const P: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

const INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9] as const;

/** Strip spaces and hyphens users commonly type ("1234 5678 9012"). */
export function normalizeAadhaar(input: string): string {
  return input.replace(/[\s-]/g, '');
}

export function verhoeffValidate(num: string): boolean {
  let c = 0;
  const digits = num.split('').reverse().map(Number);
  for (let i = 0; i < digits.length; i++) {
    c = D[c]![P[i % 8]![digits[i]!]!]!;
  }
  return c === 0;
}

/** Compute the Verhoeff check digit for a numeric string. */
export function verhoeffCheckDigit(num: string): number {
  let c = 0;
  const digits = num.split('').reverse().map(Number);
  for (let i = 0; i < digits.length; i++) {
    c = D[c]![P[(i + 1) % 8]![digits[i]!]!]!;
  }
  return INV[c]!;
}

export function isValidAadhaar(input: string): boolean {
  const n = normalizeAadhaar(input);
  return /^[2-9][0-9]{11}$/.test(n) && verhoeffValidate(n);
}

/** "XXXX XXXX 1234" — the only form Aadhaar is ever displayed in. */
export function maskAadhaar(last4: string): string {
  return `XXXX XXXX ${last4}`;
}

/** Build a valid (checksummed) Aadhaar-format number from 11 leading digits — test/seed use only. */
export function makeAadhaar(first11: string): string {
  if (!/^[2-9][0-9]{10}$/.test(first11)) throw new Error('first11 must be 11 digits starting 2-9');
  return first11 + String(verhoeffCheckDigit(first11));
}

/** Indian mobile numbers: 10 digits starting 6–9. */
export function isValidMobile(input: string): boolean {
  return /^[6-9][0-9]{9}$/.test(input);
}
