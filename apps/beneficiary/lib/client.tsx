'use client';
import { createContext, useContext, type ReactNode } from 'react';
import { ApiError, createApi } from '@srms/ui';
import type { ZodError } from 'zod';
import { useI18n, type TKey } from './i18n';
import type { Me } from './types';

export const api = createApi('beneficiary', () => {
  if (!/^\/(login|register)/.test(location.pathname)) location.href = '/login';
});

/** Localised message for an API / network error (falls back to the API's English text). */
export function useErrorText() {
  const { t } = useI18n();
  return (err: unknown): string => {
    if (err instanceof ApiError) {
      const key = `err.${err.code}` as TKey;
      const text = t(key);
      return text === key ? err.message : text;
    }
    return t('err.NETWORK');
  };
}

/** Map zod issues to { field: localised message }. */
export function useFieldErrors() {
  const { t } = useI18n();
  const byField: Record<string, TKey> = {
    mobile: 'invalid.mobile',
    otp: 'invalid.otp',
    aadhaar: 'invalid.aadhaar',
    name: 'invalid.name',
    address: 'invalid.address',
    pincode: 'invalid.pincode',
    description: 'invalid.description',
  };
  return (error: ZodError): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const issue of error.issues) {
      const path = issue.path.join('.');
      const leaf = String(issue.path.at(-1) ?? '');
      out[path] ??= t(byField[leaf] ?? 'invalid.required');
    }
    return out;
  };
}

// ─── logged-in user (provided by the (app) layout) ─────────────────────────

const MeContext = createContext<{ me: Me; reload: () => void } | null>(null);
export function MeProvider({ value, children }: { value: { me: Me; reload: () => void }; children: ReactNode }) {
  return <MeContext.Provider value={value}>{children}</MeContext.Provider>;
}
export function useMe() {
  const ctx = useContext(MeContext);
  if (!ctx) throw new Error('useMe outside the app layout');
  return ctx;
}
