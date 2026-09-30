'use client';
import { I18nProvider } from '@/lib/i18n';
import type { ReactNode } from 'react';

export function Providers({ children }: { children: ReactNode }) {
  return <I18nProvider storageKey="srms-lang-beneficiary">{children}</I18nProvider>;
}
