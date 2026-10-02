'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { ApiError, createApi } from '@srms/ui-kit';
import { useI18n, type TKey } from './dealer-i18n';
import { load, patch, save, type Pending, type Saved } from './offline-store';
import type { Commodity, Me, Roster, Shop } from './dealer-types';

export const api = createApi('dealer', () => {
  if (!location.pathname.startsWith('/login')) location.href = '/login';
});

export const isNetworkError = (err: unknown) => err instanceof ApiError && err.status === 0;

/**
 * GET with a saved copy: shows the last good response at once and whenever the
 * network fails (NFR-2). `savedAt` is set while the copy, not fresh data, is shown.
 */
export function useCachedGet<T>(path: string | null, key: string | null) {
  const res = api.useGet<T>(path);
  const [saved, setSaved] = useState<Saved<T> | null>(null);
  useEffect(() => setSaved(key ? load<T>(key) : null), [key]); // after mount: no hydration mismatch
  useEffect(() => {
    if (key && res.data !== undefined) save(key, res.data);
  }, [key, res.data]);
  const networkError = isNetworkError(res.error);
  return {
    data: res.data ?? saved?.value,
    savedAt: res.data !== undefined ? null : (saved?.savedAt ?? null),
    error: res.data !== undefined || (saved && networkError) ? undefined : res.error,
    networkError,
    loading: res.loading,
    reload: res.reload,
  };
}

/** Localised message for an API or network error (falls back to the API's English text). */
export function useErrorText() {
  const { t } = useI18n();
  return (err: unknown): string => {
    if (err instanceof ApiError) {
      const key = (err.status === 0 ? 'err.NETWORK' : `err.${err.code}`) as TKey;
      const text = t(key);
      return text === key ? err.message : text;
    }
    return t('err.NETWORK');
  };
}

export const rosterKey = (shopId: string) => `roster:${shopId}`;
export const SHOPS_KEY = 'shops';

/** Record ration handed over on this device's saved copies (roster quota and shop stock), so offline issuing stays honest. */
export function applyIssueLocally(shopId: string, beneficiaryId: string, items: { commodityId: number; quantity: number }[], stockToo: boolean) {
  const used = new Map(items.map((i) => [i.commodityId, i.quantity]));
  patch<Roster>(rosterKey(shopId), (r) => ({
    ...r,
    beneficiaries: r.beneficiaries.map((b) =>
      b.id !== beneficiaryId ? b : { ...b, quota: b.quota.map((q) => ({ ...q, remaining: Math.max(0, q.remaining - (used.get(q.commodityId) ?? 0)) })) },
    ),
  }));
  if (stockToo) applyStockLocally(shopId, items.map((i) => ({ ...i, quantity: -i.quantity })));
}

/** + delivered / − issued, on the saved copy of the shop's stock. */
export function applyStockLocally(shopId: string, changes: { commodityId: number; quantity: number }[]) {
  const delta = new Map(changes.map((c) => [c.commodityId, c.quantity]));
  patch<Shop[]>(SHOPS_KEY, (shops) =>
    shops.map((s) =>
      s.id !== shopId ? s : { ...s, stock: s.stock.map((l) => ({ ...l, quantityAvailable: Math.max(0, l.quantityAvailable + (delta.get(l.commodityId) ?? 0)) })) },
    ),
  );
}

// ─── shared state of the signed-in app (provided by components/dealer-shell.tsx) ─

export interface DealerState {
  me: Me;
  shops: Shop[];
  shop: Shop | undefined;
  setShopId: (id: string) => void;
  /** Non-null while the shop list shown is a saved copy. */
  shopsSavedAt: string | null;
  reloadShops: () => void;
  commodities: Commodity[];
  online: boolean;
  queue: Pending[];
  enqueue: (p: Pending) => void;
  removePending: (id: string) => void;
  syncNow: () => Promise<void>;
}

export const DealerContext = createContext<DealerState | null>(null);
export function useDealer(): DealerState {
  const ctx = useContext(DealerContext);
  if (!ctx) throw new Error('useDealer outside the signed-in layout');
  return ctx;
}

/** Commodity name in the current language, from the saved commodity list. */
export function useItemName() {
  const { lang } = useI18n();
  const { commodities } = useDealer();
  return (commodityId: number) => {
    const c = commodities.find((x) => x.id === commodityId);
    return c ? (lang === 'hi' && c.nameHi ? c.nameHi : c.name) : `#${commodityId}`;
  };
}
