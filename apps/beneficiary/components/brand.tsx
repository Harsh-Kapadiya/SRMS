'use client';
import Link from 'next/link';
import { Languages } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

export function Logo({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label={t('app.name')}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon.svg" alt="" width={compact ? 32 : 40} height={compact ? 32 : 40} className="rounded-lg" />
      {!compact && (
        <span className="leading-tight">
          <span className="block text-lg font-bold text-ink">{t('app.name')}</span>
          <span className="block text-xs text-ink-3">{t('app.tagline')}</span>
        </span>
      )}
    </Link>
  );
}

export function LangToggle() {
  const { lang, setLang, t } = useI18n();
  return (
    <button
      type="button"
      onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}
      title={t('lang.label')}
      aria-label={t('lang.label')}
      className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-sm font-semibold text-ink-2 hover:bg-surface-3"
    >
      <Languages className="size-4" aria-hidden />
      {t('lang.other')}
    </button>
  );
}
