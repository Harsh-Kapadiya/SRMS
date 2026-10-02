'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, ClipboardList, HandPlatter, KeyRound, LogOut, Package, RefreshCw, UserRound, WifiOff } from 'lucide-react';
import { Alert, Button, ChangePassword, LangToggle, Loading, cx, fmtAgo, type ApiError } from '@srms/ui-kit';
import { DealerContext, SHOPS_KEY, api, rosterKey, useCachedGet, useErrorText, type DealerState } from '@/lib/dealer-api';
import { useI18n, type TKey } from '@/lib/dealer-i18n';
import { clearSaved, readQueue, save, writeQueue, type Pending } from '@/lib/offline-store';
import type { Alert as AlertRow, Commodity, Me, Roster, Shop } from '@/lib/dealer-types';

const NAV: { href: string; label: TKey; icon: typeof Bell }[] = [
  { href: '/', label: 'nav.issue', icon: HandPlatter },
  { href: '/stock', label: 'nav.stock', icon: Package },
  { href: '/history', label: 'nav.history', icon: ClipboardList },
  { href: '/alerts', label: 'nav.alerts', icon: Bell },
];

/** Signed-in frame: header, status strip, bottom tabs, and the offline sync loop. */
export function DealerShell({ children }: { children: ReactNode }) {
  const { t, lang, setLang } = useI18n();
  const errorText = useErrorText();
  const path = usePathname();
  const me = useCachedGet<{ user: Me }>('/auth/me', 'me');
  const shopsRes = useCachedGet<Shop[]>(me.data ? '/dealer/shops' : null, SHOPS_KEY);
  const commoditiesRes = useCachedGet<Commodity[]>('/public/commodities', 'commodities');
  const alerts = useCachedGet<AlertRow[]>(me.data ? `/dealer/notifications?_=${path === '/alerts' ? 'open' : 'closed'}` : null, 'alerts');
  const userId = me.data?.user.id;

  // ── online state: the browser's flag, and whether the API actually answers ──
  const [browserOnline, setBrowserOnline] = useState(true);
  useEffect(() => {
    const update = () => setBrowserOnline(navigator.onLine);
    update();
    addEventListener('online', update);
    addEventListener('offline', update);
    return () => {
      removeEventListener('online', update);
      removeEventListener('offline', update);
    };
  }, []);
  const online = browserOnline && !shopsRes.networkError;

  // ── selected shop (a dealer runs up to 3) ──
  const [shopId, setShopIdState] = useState<string | null>(null);
  const shops = useMemo(() => shopsRes.data ?? [], [shopsRes.data]);
  const setShopId = useCallback((id: string) => {
    setShopIdState(id);
    localStorage.setItem('srms-dealer:shop', id);
  }, []);
  useEffect(() => {
    if (!shops.length) return;
    const saved = localStorage.getItem('srms-dealer:shop');
    const pick = shops.find((s) => s.id === (shopId ?? saved)) ?? shops.find((s) => s.status === 'ACTIVE') ?? shops[0]!;
    if (pick.id !== shopId) setShopId(pick.id);
  }, [shops, shopId, setShopId]);

  // ── saved roster per shop, refreshed whenever we are online ──
  const refreshRosters = useCallback(async () => {
    for (const s of me.data?.user.dealer?.shops ?? []) {
      try {
        save(rosterKey(s.id), await api.get<Roster>(`/dealer/shops/${s.id}/roster`));
      } catch {
        /* keep the previous copy */
      }
    }
  }, [me.data]);

  // ── queue of offline entries ──
  const [queue, setQueue] = useState<Pending[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<{ sent: number; late: number; conflicts: number } | null>(null);
  const busy = useRef(false);
  useEffect(() => {
    if (userId) setQueue(readQueue(userId));
  }, [userId]);
  const errorTextRef = useRef(errorText);
  errorTextRef.current = errorText;
  const reloadShopsRef = useRef(shopsRes.reload);
  reloadShopsRef.current = shopsRes.reload;

  const syncNow = useCallback(async () => {
    if (!userId || busy.current || !navigator.onLine) return;
    const todo = readQueue(userId).filter((p) => !p.conflict);
    if (!todo.length) return;
    busy.current = true;
    setSyncing(true);
    let sent = 0;
    let late = 0;
    let conflicts = 0;
    for (const p of todo) {
      try {
        const r = await api.post<{ syncedLate?: boolean }>(p.path, p.body);
        sent++;
        if (r.syncedLate) late++;
        writeQueue(userId, readQueue(userId).filter((x) => x.id !== p.id));
      } catch (err) {
        const e = err as ApiError;
        if (e.status === 0 || e.status === 401 || e.status === 429 || e.status >= 500) break; // try again later
        conflicts++; // refused for good (quota already used, not enough stock …): keep it for the dealer to see
        writeQueue(userId, readQueue(userId).map((x) => (x.id === p.id ? { ...x, conflict: { code: e.code, message: errorTextRef.current(e) } } : x)));
      }
    }
    busy.current = false;
    setSyncing(false);
    setQueue(readQueue(userId));
    if (sent || conflicts) {
      setLastSync({ sent, late, conflicts });
      reloadShopsRef.current();
      void refreshRosters();
    }
  }, [userId, refreshRosters]);

  // Send on start, when the connection returns, and every 30 s while anything waits.
  const syncRef = useRef(syncNow);
  syncRef.current = syncNow;
  useEffect(() => {
    if (!userId) return;
    void refreshRosters();
    void syncRef.current();
    const back = () => {
      reloadShopsRef.current();
      void syncRef.current();
    };
    addEventListener('online', back);
    const timer = setInterval(() => {
      if (shopsRes.networkError) reloadShopsRef.current(); // browser says online but the API did not answer: probe again
      void syncRef.current();
    }, 30_000);
    return () => {
      removeEventListener('online', back);
      clearInterval(timer);
    };
  }, [userId, refreshRosters, shopsRes.networkError]);

  const enqueue = useCallback(
    (p: Pending) => {
      if (!userId) return;
      writeQueue(userId, [...readQueue(userId), p]);
      setQueue(readQueue(userId));
      void syncRef.current(); // in case the connection is actually fine
    },
    [userId],
  );
  const removePending = useCallback(
    (id: string) => {
      if (!userId) return;
      writeQueue(userId, readQueue(userId).filter((x) => x.id !== id));
      setQueue(readQueue(userId));
    },
    [userId],
  );

  // App-shell cache for offline reloads (production builds only; `next dev` rebuilds files constantly).
  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) navigator.serviceWorker.register('/dealer-sw.js').catch(() => undefined);
  }, []);

  const [pwOpen, setPwOpen] = useState(false);
  const logout = async () => {
    const waiting = queue.filter((p) => !p.conflict).length;
    if (waiting && !confirm(t('account.logoutPending', { n: waiting }))) return;
    await api.post('/auth/logout').catch(() => undefined);
    clearSaved();
    location.replace('/login');
  };

  const state = useMemo<DealerState | null>(
    () =>
      me.data
        ? {
            me: me.data.user,
            shops,
            shop: shops.find((s) => s.id === shopId),
            setShopId,
            shopsSavedAt: shopsRes.savedAt,
            reloadShops: shopsRes.reload,
            commodities: commoditiesRes.data ?? [],
            online,
            queue,
            enqueue,
            removePending,
            syncNow,
          }
        : null,
    [me.data, shops, shopId, setShopId, shopsRes.savedAt, shopsRes.reload, commoditiesRes.data, online, queue, enqueue, removePending, syncNow],
  );

  if (!state) {
    if (me.networkError) return <main className="mx-auto max-w-md px-4 py-16"><Alert tone="warn" title={t('offline.title')}>{t('offline.noData')}</Alert></main>;
    if (me.error) return <main className="mx-auto max-w-md px-4 py-16"><Alert tone="bad" title={errorText(me.error)} action={<Button size="sm" variant="secondary" onClick={me.reload}>{t('common.retry')}</Button>} /></main>;
    return <Loading label={t('common.loading')} />;
  }

  const waiting = queue.filter((p) => !p.conflict).length;
  const conflicts = queue.length - waiting;
  const unread = alerts.data?.filter((a) => !a.readAt).length ?? 0;
  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));

  return (
    <DealerContext.Provider value={state}>
      <header className="no-print sticky top-0 z-20 border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-3 py-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" width={34} height={34} className="shrink-0 rounded-lg" />
          {shops.length > 1 ? (
            <select
              aria-label={t('shop.label')}
              value={shopId ?? ''}
              onChange={(e) => setShopId(e.target.value)}
              className="min-w-0 flex-1 truncate rounded-lg border border-line bg-surface px-2 py-2 text-sm font-semibold"
            >
              {shops.map((s) => (
                <option key={s.id} value={s.id}>{s.name}{s.status !== 'ACTIVE' ? ' ✕' : ''}</option>
              ))}
            </select>
          ) : (
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{state.shop?.name}</span>
          )}
          <nav className="hidden gap-1 md:flex" aria-label="Main">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} aria-current={active(n.href) ? 'page' : undefined} className={cx('rounded-lg px-3 py-2 text-sm font-semibold', active(n.href) ? 'bg-brand-soft text-brand-strong' : 'text-ink-2 hover:bg-surface-3')}>
                {t(n.label)}
                {n.href === '/alerts' && unread > 0 && <span className="ml-1 rounded-full bg-accent px-1.5 text-xs text-white">{unread}</span>}
              </Link>
            ))}
          </nav>
          <LangToggle lang={lang} setLang={setLang} />
          <details className="relative">
            <summary className="flex size-10 cursor-pointer list-none items-center justify-center rounded-full border border-line hover:bg-surface-3" aria-label={t('account.menu')}>
              <UserRound className="size-5 text-ink-2" aria-hidden />
            </summary>
            <div className="absolute right-0 top-12 z-30 w-60 rounded-xl border border-line bg-surface p-2 shadow-xl">
              <p className="truncate px-2 pt-1 text-sm font-semibold">{state.me.fullName}</p>
              <p className="truncate px-2 pb-2 text-xs text-ink-3">{state.me.dealer?.licenseNo}</p>
              <button type="button" onClick={() => setPwOpen(true)} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-surface-3">
                <KeyRound className="size-4" aria-hidden />{t('pw.change')}
              </button>
              <button type="button" onClick={logout} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-surface-3">
                <LogOut className="size-4" aria-hidden />{t('account.logout')}
              </button>
            </div>
          </details>
        </div>
        <StatusStrip
          online={online}
          syncing={syncing}
          waiting={waiting}
          conflicts={conflicts}
          savedAt={shopsRes.savedAt}
          lastSync={lastSync}
          onSync={syncNow}
          onDismiss={() => setLastSync(null)}
        />
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-28 pt-4 md:pb-12">{children}</main>

      <nav className="no-print fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface md:hidden" aria-label="Main">
        <ul className="mx-auto grid max-w-md grid-cols-4 pb-[env(safe-area-inset-bottom)]">
          {NAV.map(({ href, label, icon: Icon }) => (
            <li key={href}>
              <Link href={href} aria-current={active(href) ? 'page' : undefined} className={cx('relative flex flex-col items-center gap-0.5 py-2.5 text-xs font-semibold', active(href) ? 'text-brand' : 'text-ink-3')}>
                <Icon className="size-6" aria-hidden strokeWidth={active(href) ? 2.4 : 1.8} />
                {t(label)}
                {href === '/alerts' && unread > 0 && <span className="absolute right-[calc(50%-1.6rem)] top-1 rounded-full bg-accent px-1.5 text-[11px] text-white">{unread > 9 ? '9+' : unread}</span>}
                {href === '/history' && queue.length > 0 && <span className="absolute right-[calc(50%-1.6rem)] top-1 rounded-full bg-warn px-1.5 text-[11px] text-white">{queue.length}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <ChangePassword
        api={api}
        open={pwOpen}
        onClose={() => setPwOpen(false)}
        errorText={errorText}
        text={{
          changePassword: t('pw.change'), currentPassword: t('pw.current'), newPassword: t('pw.new'), newPasswordHint: t('pw.newHint'),
          repeatPassword: t('pw.repeat'), passwordsDiffer: t('pw.differ'), passwordChanged: t('pw.changed'), passwordChangedHint: t('pw.changedHint'), done: t('pw.done'),
        }}
      />
    </DealerContext.Provider>
  );
}

/** One line under the header: connection, entries waiting to be sent, and the last sync result. */
function StatusStrip({ online, syncing, waiting, conflicts, savedAt, lastSync, onSync, onDismiss }: {
  online: boolean;
  syncing: boolean;
  waiting: number;
  conflicts: number;
  savedAt: string | null;
  lastSync: { sent: number; late: number; conflicts: number } | null;
  onSync: () => void;
  onDismiss: () => void;
}) {
  const { t, lang } = useI18n();
  return (
    <div role="status" className={cx('border-t border-line text-sm', online ? 'bg-surface-2' : 'bg-warn-soft')}>
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5">
        {online ? (
          <span className="inline-flex items-center gap-1.5 font-semibold text-ok"><span className="size-2 rounded-full bg-ok" aria-hidden />{t('status.online')}</span>
        ) : (
          <span className="inline-flex items-center gap-1.5 font-semibold text-warn"><WifiOff className="size-4" aria-hidden />{t('status.offline')}</span>
        )}
        {!online && savedAt && <span className="text-ink-3">{t('common.savedAt', { ago: fmtAgo(savedAt, lang) })}</span>}
        {syncing && <span className="inline-flex items-center gap-1.5 text-ink-2"><RefreshCw className="size-3.5 animate-spin" aria-hidden />{t('status.syncing')}</span>}
        {!syncing && waiting > 0 && (
          <span className="inline-flex items-center gap-2 font-semibold text-warn">
            {t('status.pending', { n: waiting })}
            {online && <button type="button" onClick={onSync} className="rounded-md border border-line bg-surface px-2 py-0.5 text-xs text-ink-2">{t('sync.now')}</button>}
          </span>
        )}
        {lastSync && (
          <span className="inline-flex flex-wrap items-center gap-x-2">
            {lastSync.sent > 0 && <span className="font-semibold text-ok">{t('sync.done', { n: lastSync.sent })}</span>}
            {lastSync.late > 0 && <span className="text-warn">{t('sync.late', { n: lastSync.late })}</span>}
            <button type="button" onClick={onDismiss} className="text-ink-3 underline">×</button>
          </span>
        )}
        {conflicts > 0 && (
          <Link href="/history" className="font-semibold text-bad underline">{t('sync.conflicts', { n: conflicts })} {t('sync.see')}</Link>
        )}
      </div>
    </div>
  );
}

