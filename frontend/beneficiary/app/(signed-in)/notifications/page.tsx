'use client';
import { useEffect } from 'react';
import { Bell, CheckCircle2, CircleAlert, MessageSquareWarning, PackageCheck, Truck, UserCheck, type LucideIcon } from 'lucide-react';
import { Card, Empty, Loading, PageHeader, cx, fmtAgo } from '@srms/ui-kit';
import { api } from '@/lib/beneficiary-api';
import { useI18n } from '@/lib/beneficiary-i18n';
import type { Notification, Paged } from '@/lib/beneficiary-types';

const ICON: Record<string, LucideIcon> = {
  REGISTRATION_RECEIVED: UserCheck,
  REGISTRATION_APPROVED: CheckCircle2,
  REGISTRATION_REJECTED: CircleAlert,
  RATION_READY: Truck,
  RATION_ISSUED: PackageCheck,
  COMPLAINT_FILED: MessageSquareWarning,
  COMPLAINT_UPDATED: MessageSquareWarning,
};

/** FR-7: the SMS alerts, also kept in-app. Opening the page marks them read. */
export default function NotificationsPage() {
  const { t, lang } = useI18n();
  const res = api.useGet<Paged<Notification>>('/me/notifications?pageSize=50');
  useEffect(() => {
    if (res.data?.items.some((n) => !n.readAt)) void api.post('/me/notifications/read');
  }, [res.data]);

  if (!res.data) return <Loading label={t('common.loading')} />;
  return (
    <>
      <PageHeader title={t('notifications.title')} />
      {!res.data.items.length ? (
        <Card><Empty icon={<Bell className="size-10" />} title={t('notifications.empty')}>{t('notifications.emptyBody')}</Empty></Card>
      ) : (
        <Card flush>
          <ul className="divide-y divide-line">
            {res.data.items.map((n) => {
              const Icon = ICON[n.event] ?? Bell;
              return (
                <li key={n.id} className={cx('flex gap-3 px-5 py-4', !n.readAt && 'bg-brand-soft/50')}>
                  <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-3 text-ink-2"><Icon className="size-5" aria-hidden /></span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{t(`event.${n.event}` as 'event.GENERIC')}</span>
                      <time className="shrink-0 text-xs text-ink-3" dateTime={n.createdAt}>{fmtAgo(n.createdAt, lang)}</time>
                    </p>
                    <p className="mt-0.5 text-sm text-ink-2">{n.message}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}
