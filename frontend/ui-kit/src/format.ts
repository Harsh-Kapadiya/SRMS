import type { Lang } from './i18n';

const TZ = 'Asia/Kolkata';
const locale = (lang: Lang) => (lang === 'hi' ? 'hi-IN' : 'en-IN');

export const fmtNum = (n: number, lang: Lang = 'en', maxFrac = 3) =>
  new Intl.NumberFormat(locale(lang), { maximumFractionDigits: maxFrac }).format(n);

/** KG → kg, LITRE → l, PACKET → pkt */
export const unitLabel = (unit: string) => ({ KG: 'kg', LITRE: 'l', PACKET: 'pkt' } as Record<string, string>)[unit] ?? unit.toLowerCase();

/** 12 kg · 1.5 l · 2 pkt */
export const fmtQty = (n: number, unit: string, lang: Lang = 'en') => `${fmtNum(n, lang)} ${unitLabel(unit)}`;

export const fmtMoney = (n: number, lang: Lang = 'en') =>
  new Intl.NumberFormat(locale(lang), { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n);

export const fmtDate = (iso: string | null | undefined, lang: Lang = 'en') =>
  iso ? new Intl.DateTimeFormat(locale(lang), { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso)) : '—';

export const fmtDateTime = (iso: string | null | undefined, lang: Lang = 'en') =>
  iso
    ? new Intl.DateTimeFormat(locale(lang), { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
    : '—';

/** "2026-09-01" → "September 2026" */
export const fmtMonth = (monthKey: string, lang: Lang = 'en') =>
  new Intl.DateTimeFormat(locale(lang), { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${monthKey.slice(0, 7)}-01T00:00:00Z`));

export const fmtPct = (n: number, lang: Lang = 'en') => `${fmtNum(n, lang, 1)}%`;

/** "2 hours ago" style relative time. */
export function fmtAgo(iso: string, lang: Lang = 'en'): string {
  const rtf = new Intl.RelativeTimeFormat(locale(lang), { numeric: 'auto' });
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000], ['month', 2_592_000], ['day', 86_400], ['hour', 3600], ['minute', 60],
  ];
  for (const [unit, secs] of steps) if (Math.abs(s) >= secs) return rtf.format(Math.round(s / secs), unit);
  return rtf.format(Math.round(s), 'second');
}
