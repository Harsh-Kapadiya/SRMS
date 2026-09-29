import { describe, expect, it } from 'vitest';
import { addMonths, istMonthKey } from './month';

describe('IST month helpers', () => {
  it('uses the Indian calendar month, not UTC', () => {
    // 30 Sep 2026 20:00 UTC is already 1 Oct 01:30 in India
    expect(istMonthKey(new Date('2026-09-30T20:00:00Z'))).toBe('2026-10-01');
    expect(istMonthKey(new Date('2026-09-30T18:00:00Z'))).toBe('2026-09-01');
  });

  it('shifts months across year boundaries', () => {
    expect(addMonths('2026-01-01', -1)).toBe('2025-12-01');
    expect(addMonths('2026-11-01', 3)).toBe('2027-02-01');
  });
});
