'use client';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, History, Home, MessageSquareWarning, UserRound } from 'lucide-react';
import { Alert, Button, Loading, cx } from '@srms/ui';
import { LangToggle, Logo } from '@/components/brand';
import { MeProvider, api } from '@/lib/client';
import { useI18n, type TKey } from '@/lib/i18n';
import type { Me } from '@/lib/types';

const NAV: { href: string; label: TKey; icon: typeof Home }[] = [
  { href: '/', label: 'nav.home', icon: Home },
  { href: '/history', label: 'nav.history', icon: History },
  { href: '/complaints', label: 'nav.complaints', icon: MessageSquareWarning },
  { href: '/profile', label: 'nav.profile', icon: UserRound },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const path = usePathname();
  const me = api.useGet<{ user: Me }>('/auth/me');
  const unread = api.useGet<{ unread: number }>(`/me/notifications?pageSize=1&_=${path}`);

  if (!me.data) {
    return me.error ? (
      <main className="mx-auto max-w-md px-4 py-16">
        <Alert tone="bad" title={me.error.message} action={<Button size="sm" variant="secondary" onClick={me.reload}>{t('common.retry')}</Button>} />
      </main>
    ) : (
      <Loading label={t('common.loading')} />
    );
  }

  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));
  return (
    <MeProvider value={{ me: me.data.user, reload: me.reload }}>
      <header className="no-print sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-2.5">
          <Logo compact />
          <nav className="ml-4 hidden gap-1 md:flex" aria-label="Main">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} aria-current={active(n.href) ? 'page' : undefined} className={cx('rounded-lg px-3 py-2 text-sm font-semibold', active(n.href) ? 'bg-brand-soft text-brand-strong' : 'text-ink-2 hover:bg-surface-3')}>
                {t(n.label)}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <LangToggle />
            <Link href="/notifications" className="relative inline-flex size-10 items-center justify-center rounded-full border border-line bg-surface hover:bg-surface-3" aria-label={`${t('nav.notifications')}${unread.data?.unread ? ` (${unread.data.unread})` : ''}`}>
              <Bell className="size-5 text-ink-2" aria-hidden />
              {!!unread.data?.unread && (
                <span className="absolute -right-0.5 -top-0.5 flex min-w-5 items-center justify-center rounded-full bg-accent px-1 text-xs font-bold text-white">{unread.data.unread > 9 ? '9+' : unread.data.unread}</span>
              )}
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-28 pt-5 md:pb-12">{children}</main>

      <nav className="no-print fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface md:hidden" aria-label="Main">
        <ul className="mx-auto grid max-w-md grid-cols-4 pb-[env(safe-area-inset-bottom)]">
          {NAV.map(({ href, label, icon: Icon }) => (
            <li key={href}>
              <Link href={href} aria-current={active(href) ? 'page' : undefined} className={cx('flex flex-col items-center gap-0.5 py-2.5 text-xs font-semibold', active(href) ? 'text-brand' : 'text-ink-3')}>
                <Icon className="size-6" aria-hidden strokeWidth={active(href) ? 2.4 : 1.8} />
                {t(label)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </MeProvider>
  );
}
