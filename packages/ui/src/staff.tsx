'use client';
/**
 * Building blocks shared by the three staff apps (official, admin, dealer):
 * email/password login, the logged-in shell with sidebar navigation, a native
 * <dialog> modal and a pager.
 */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { createApi } from './api';
import { Alert, Button, Card, Field, Input, Loading, cx } from './components';

type Api = ReturnType<typeof createApi>;

export interface StaffUser {
  id: string;
  role: string;
  fullName: string;
  email: string | null;
  official?: { id: string; designation: string; districtId: number | null; district: { id: number; name: string } | null } | null;
  dealer?: { id: string; licenseNo: string; district: { id: number; name: string }; shops: { id: string; shopCode: string; name: string; address: string; status: string }[] } | null;
}

// ─── login ───────────────────────────────────────────────────────────────────

export function StaffLogin({ api, title, subtitle, demo }: { api: Api; title: string; subtitle: string; demo?: { label: string; email: string; password: string }[] }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api.post('/auth/login', { email, password });
      location.replace('/'); // full load: drop anything prefetched while logged out
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1fr_minmax(420px,520px)]">
      <section className="relative hidden overflow-hidden bg-gradient-to-br from-brand-strong to-brand p-12 text-on-brand lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" width={44} height={44} className="rounded-xl bg-white/10" />
          <span className="text-lg font-bold">Smart Ration Distribution System</span>
        </div>
        <div>
          <h1 className="max-w-md text-4xl font-bold leading-tight">{title}</h1>
          <p className="mt-3 max-w-md text-lg opacity-85">{subtitle}</p>
        </div>
        <p className="text-sm opacity-70">Public Distribution System · Bihar</p>
        <div className="pointer-events-none absolute -bottom-24 -right-24 size-96 rounded-full bg-white/10" aria-hidden />
      </section>
      <section className="flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <h2 className="text-2xl font-bold lg:hidden">{title}</h2>
          <h2 className="hidden text-2xl font-bold lg:block">Sign in</h2>
          <p className="mt-1 text-ink-3">Use your official email and password.</p>
          <Card className="mt-6">
            <form onSubmit={submit} className="space-y-4" noValidate>
              <Field label="Email">
                {(id) => <Input id={id} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />}
              </Field>
              <Field label="Password">
                {(id) => <Input id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}
              </Field>
              {error && <Alert tone="bad" title={error} />}
              <Button type="submit" size="lg" block loading={busy}>Sign in</Button>
            </form>
          </Card>
          {demo && demo.length > 0 && (
            <div className="mt-5 rounded-xl border border-dashed border-line p-4 text-sm">
              <p className="font-semibold text-ink-2">Demo accounts</p>
              <ul className="mt-2 space-y-1.5">
                {demo.map((d) => (
                  <li key={d.email}>
                    <button type="button" className="text-left text-brand hover:underline" onClick={() => { setEmail(d.email); setPassword(d.password); }}>
                      {d.label}: <span className="font-mono">{d.email}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

// ─── logged-in shell ─────────────────────────────────────────────────────────

export interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
}

/** Loads /auth/me, then renders the sidebar shell. Children get the user via render prop. */
export function StaffShell({ api, appName, nav, subtitle, children }: {
  api: Api;
  appName: string;
  nav: NavItem[];
  subtitle?: (user: StaffUser) => ReactNode;
  children: (user: StaffUser) => ReactNode;
}) {
  const me = api.useGet<{ user: StaffUser }>('/auth/me');
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);

  if (!me.data) {
    return me.error ? (
      <main className="mx-auto max-w-md px-4 py-16">
        <Alert tone="bad" title={me.error.message} action={<Button size="sm" variant="secondary" onClick={me.reload}>Retry</Button>} />
      </main>
    ) : (
      <Loading />
    );
  }
  const user = me.data.user;
  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));
  const logout = async () => {
    await api.post('/auth/logout').catch(() => undefined);
    location.replace('/login');
  };

  const sidebar = (
    <nav aria-label="Main" className="flex h-full flex-col gap-1 p-3">
      <Link href="/" className="mb-4 flex items-center gap-2.5 px-2 py-1.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.svg" alt="" width={34} height={34} className="rounded-lg" />
        <span className="leading-tight">
          <span className="block font-bold">SRMS</span>
          <span className="block text-xs text-ink-3">{appName}</span>
        </span>
      </Link>
      {nav.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          aria-current={active(n.href) ? 'page' : undefined}
          className={cx(
            'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold',
            active(n.href) ? 'bg-brand-soft text-brand-strong' : 'text-ink-2 hover:bg-surface-3',
          )}
        >
          <span className="size-5 [&>svg]:size-5" aria-hidden>{n.icon}</span>
          {n.label}
        </Link>
      ))}
      <div className="mt-auto rounded-xl border border-line p-3">
        <p className="truncate text-sm font-semibold">{user.fullName}</p>
        <p className="truncate text-xs text-ink-3">{subtitle?.(user) ?? user.email}</p>
        <Button variant="secondary" size="sm" block className="mt-3" onClick={logout}>Log out</Button>
      </div>
    </nav>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[240px_1fr] print:block">
      <aside className="no-print sticky top-0 hidden h-dvh border-r border-line bg-surface lg:block">{sidebar}</aside>
      <header className="no-print sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface px-4 py-2.5 lg:hidden">
        <span className="font-bold">SRMS · {appName}</span>
        <Button variant="secondary" size="sm" aria-expanded={open} aria-controls="mobile-nav" onClick={() => setOpen((o) => !o)}>
          Menu
        </Button>
      </header>
      {open && (
        <div id="mobile-nav" className="no-print fixed inset-0 top-[57px] z-20 bg-surface lg:hidden">
          {sidebar}
        </div>
      )}
      <main className="min-w-0 px-4 py-6 lg:px-8">{children(user)}</main>
    </div>
  );
}

// ─── modal (native <dialog>: focus trap, Esc and backdrop for free) ───────────

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx('m-auto w-[calc(100%-2rem)] rounded-2xl border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-black/40', wide ? 'max-w-3xl' : 'max-w-lg')}
    >
      {open && (
        <div className="p-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 className="text-lg font-bold">{title}</h2>
            <button type="button" onClick={onClose} className="rounded-lg px-2 text-2xl leading-none text-ink-3 hover:bg-surface-3" aria-label="Close">×</button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

// ─── pager ───────────────────────────────────────────────────────────────────

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between gap-3 pt-4 text-sm text-ink-3">
      <span>{from}–{to} of {total.toLocaleString('en-IN')}</span>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <Button size="sm" variant="secondary" disabled={to >= total} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

/** Save a Blob (e.g. an Excel export) as a file. */
export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: fileName });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
