/**
 * NFR-2 offline mode, on the device itself (no server involved):
 *  - saved copies of what the app last downloaded (shops, stock, the shop's
 *    beneficiary roster with this month's remaining quota), so the app works
 *    without internet;
 *  - a queue of entries recorded offline (ration issued, stock delivered). Each
 *    carries a clientRef, so sending it twice is harmless; the server re-checks
 *    quota and stock and refuses conflicts, which stay here for the dealer to see.
 *
 * ponytail: localStorage (~5 MB) holds ~20,000 roster entries — plenty for 3 shops.
 * Move to IndexedDB if a dealer ever needs more.
 */
const PREFIX = 'srms-dealer:';

export interface Saved<T> {
  value: T;
  savedAt: string;
}

export function load<T>(key: string): Saved<T> | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as Saved<T>) : null;
  } catch {
    return null;
  }
}

export function save<T>(key: string, value: T, savedAt = new Date().toISOString()): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ value, savedAt }));
  } catch {
    /* storage full or blocked: the app still works online */
  }
}

/** Change a saved copy in place (keeps its download time). */
export function patch<T>(key: string, fn: (v: T) => T): void {
  const s = load<T>(key);
  if (s) save(key, fn(s.value), s.savedAt);
}

/** On log out: forget saved data, but never an unsent queue (it syncs after the next log-in). */
export function clearSaved(): void {
  try {
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith(PREFIX)) continue;
      const unsent = k.endsWith(':queue') && (load<Pending[]>(k.slice(PREFIX.length))?.value.length ?? 0) > 0;
      if (!unsent) localStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}

// ─── queue of entries recorded offline ───────────────────────────────────────

export interface Pending {
  id: string; // = clientRef sent to the API
  path: '/dealer/distributions' | '/dealer/stock/receipts';
  body: Record<string, unknown>;
  shopId: string;
  /** Beneficiary name, or null for a stock delivery. */
  who: string | null;
  items: { commodityId: number; quantity: number }[];
  createdAt: string;
  /** Set when the server refused it (quota already used, not enough stock …). */
  conflict?: { code: string; message: string };
}

const queueKey = (userId: string) => `${userId}:queue`;
export const readQueue = (userId: string): Pending[] => load<Pending[]>(queueKey(userId))?.value ?? [];
export const writeQueue = (userId: string, list: Pending[]) => save(queueKey(userId), list);
