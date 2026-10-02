'use client';
import Link from 'next/link';
import { LangToggle as SharedLangToggle } from '@srms/ui-kit';
import { useI18n } from '@/lib/beneficiary-i18n';

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
  const { lang, setLang } = useI18n();
  return <SharedLangToggle lang={lang} setLang={setLang} />;
}
