import { TIMEZONE } from './constants';

/**
 * Ration entitlements are monthly and India-wide in IST. These helpers return
 * the first day of the IST month as a `YYYY-MM-01` string / UTC-midnight Date,
 * matching the SQL function srms_month(timestamptz).
 */
export function istMonthKey(at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(at);
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  return `${y}-${m}-01`;
}

/** First day of the IST month as a Date at 00:00 UTC (how Postgres DATE maps in Prisma). */
export function istMonthStart(at: Date = new Date()): Date {
  return new Date(`${istMonthKey(at)}T00:00:00.000Z`);
}

/** Shift a YYYY-MM-01 month key by n months. */
export function addMonths(monthKey: string, n: number): string {
  const [y, m] = monthKey.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}
