'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Languages } from 'lucide-react';

export type Lang = 'en' | 'hi';

/**
 * Tiny i18n (NFR-1: English + Hindi). The Hindi dictionary is typed against
 * the English one, so a missing translation is a compile error.
 * Strings may contain {placeholders}.
 */
export function createI18n<K extends string>(en: Record<K, string>, hi: Record<K, string>) {
  const dicts = { en, hi };
  type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: (key: K, vars?: Record<string, string | number>) => string };
  const I18nContext = createContext<Ctx | null>(null);

  function I18nProvider({ children, storageKey = 'srms-lang' }: { children: ReactNode; storageKey?: string }) {
    const [lang, setLangState] = useState<Lang>('en');
    useEffect(() => {
      try {
        const saved = localStorage.getItem(storageKey) as Lang | null;
        if (saved === 'en' || saved === 'hi') setLangState(saved);
        else if (navigator.language.startsWith('hi')) setLangState('hi');
      } catch {
        /* storage unavailable: keep English */
      }
    }, [storageKey]);
    useEffect(() => {
      document.documentElement.lang = lang;
    }, [lang]);
    const setLang = useCallback(
      (l: Lang) => {
        setLangState(l);
        try {
          localStorage.setItem(storageKey, l);
        } catch {
          /* ignore */
        }
      },
      [storageKey],
    );
    const value = useMemo<Ctx>(
      () => ({
        lang,
        setLang,
        t: (key, vars) => {
          let s: string = dicts[lang][key] ?? dicts.en[key] ?? key;
          if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
          return s;
        },
      }),
      [lang, setLang],
    );
    return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
  }

  function useI18n(): Ctx {
    const ctx = useContext(I18nContext);
    if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
    return ctx;
  }

  return { I18nProvider, useI18n };
}

/** Switches English ⇄ Hindi. Labels are written in both scripts so either reader finds it. */
export function LangToggle({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  return (
    <button
      type="button"
      onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}
      title="भाषा बदलें / Change language"
      aria-label="भाषा बदलें / Change language"
      className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-sm font-semibold text-ink-2 hover:bg-surface-3"
    >
      <Languages className="size-4" aria-hidden />
      {lang === 'en' ? 'हिंदी' : 'English'}
    </button>
  );
}
