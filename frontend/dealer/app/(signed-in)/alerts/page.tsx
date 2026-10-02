'use client';
import { useEffect } from 'react';
import { AlertTriangle, Bell } from 'lucide-react';
import { Alert, Card, Empty, Loading, cx, fmtAgo, fmtQty } from '@srms/ui-kit';
import { api, useCachedGet, useDealer, useErrorText, useItemName } from '@/lib/dealer-api';
import { useI18n } from '@/lib/dealer-i18n';
import type { Alert as AlertRow } from '@/lib/dealer-types';

/** R5: low-stock alerts (also sent by SMS). Opening the page marks them read. */
export default function AlertsPage() {
  const { t, lang } = useI18n();
  const errorText = useErrorText();
  const itemName = useItemName();
  const { shops, commodities, online } = useDealer();
  const alerts = useCachedGet<AlertRow[]>('/dealer/notifications', 'alerts');
  const unread = alerts.data?.some((a) => !a.readAt) ?? false;

  useEffect(() => {
    if (online && unread && !alerts.savedAt) void api.post('/dealer/notifications/read').catch(() => undefined);
  }, [online, unread, alerts.savedAt]);

  /** The SMS text is English; low-stock alerts carry their numbers, so they are shown in the chosen language. */
  function text(a: AlertRow) {
    const p = a.payload;
    if (a.event !== 'LOW_STOCK' || !p?.commodityId || p.quantityAvailable === undefined || p.threshold === undefined) return a.message;
    const unit = commodities.find((c) => c.id === p.commodityId)?.unit ?? 'KG';
    return t('alerts.LOW_STOCK', {
      item: itemName(p.commodityId),
      shop: shops.find((s) => s.id === p.shopId)?.name ?? '',
      qty: fmtQty(p.quantityAvailable, unit, lang),
      min: fmtQty(p.threshold, unit, lang),
    });
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{t('alerts.title')}</h1>
      {!alerts.data ? (
        alerts.networkError ? <p className="text-sm text-ink-3">{t('common.notSaved')}</p> : alerts.error ? <Alert tone="bad" title={errorText(alerts.error)} /> : <Loading label={t('common.loading')} />
      ) : alerts.data.length === 0 ? (
        <Empty icon={<Bell />} title={t('alerts.empty')} />
      ) : (
        <Card flush>
          <ul className="divide-y divide-line">
            {alerts.data.map((a) => (
              <li key={a.id} className={cx('flex gap-3 px-5 py-3 text-sm', !a.readAt && 'bg-warn-soft/50')}>
                <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warn" aria-hidden />
                <span>
                  <span className={cx('block', !a.readAt && 'font-semibold')}>{text(a)}</span>
                  <span className="block text-xs text-ink-3">{fmtAgo(a.createdAt, lang)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
