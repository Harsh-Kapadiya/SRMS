'use client';
import { useState, type FormEvent } from 'react';
import { Megaphone, PackagePlus } from 'lucide-react';
import { istMonthKey, stockReceiptSchema } from '@srms/shared';
import { Alert, Badge, Button, Card, Field, Input, Loading, Meter, Select, cx, fmtDateTime, fmtNum, fmtQty, unitLabel } from '@srms/ui-kit';
import { api, applyStockLocally, isNetworkError, useCachedGet, useDealer, useErrorText, useItemName } from '@/lib/dealer-api';
import { useI18n, type TKey } from '@/lib/dealer-i18n';
import type { Movement, StockLine } from '@/lib/dealer-types';

/** Today in India as YYYY-MM-DD (for <input type="date">). */
const todayIst = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

/** FR-4 stock, R5 low-stock alerts, R7 "ration has arrived" SMS. */
export default function StockPage() {
  const { t, lang } = useI18n();
  const errorText = useErrorText();
  const itemName = useItemName();
  const { shop, online, commodities, enqueue, reloadShops } = useDealer();
  const ledger = useCachedGet<{ stock: StockLine[]; movements: Movement[] }>(shop ? `/dealer/shops/${shop.id}/stock` : null, shop ? `stock:${shop.id}` : null);

  const [f, setF] = useState({ commodityId: '', quantity: '', referenceNo: '', date: todayIst(), note: '' });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'ok' | 'warn' | 'bad'; text: string }>();
  const [notifying, setNotifying] = useState(false);
  const [notified, setNotified] = useState<string>();

  if (!shop) return null;
  const unitOf = (id: number) => commodities.find((c) => c.id === id)?.unit ?? 'KG';

  async function record(e: FormEvent) {
    e.preventDefault();
    const today = f.date === todayIst();
    const check = stockReceiptSchema.safeParse({
      shopId: shop!.id, commodityId: f.commodityId || undefined, quantity: f.quantity || undefined, referenceNo: f.referenceNo,
      note: f.note.trim() || undefined, clientRef: crypto.randomUUID(),
      // A past date is recorded at midday that day; today means "now" (the database refuses future times).
      occurredAt: today ? undefined : `${f.date}T12:00:00+05:30`,
    });
    if (!check.success || f.date > todayIst()) return setResult({ tone: 'bad', text: t('stock.invalid') });
    const body = check.data;
    const label = { qty: fmtQty(body.quantity, unitOf(body.commodityId), lang), item: itemName(body.commodityId) };
    const saveOffline = () => {
      enqueue({
        id: body.clientRef!, path: '/dealer/stock/receipts', body: { ...body, occurredAt: body.occurredAt ?? new Date().toISOString() },
        shopId: shop!.id, who: null, items: [{ commodityId: body.commodityId, quantity: body.quantity }], createdAt: new Date().toISOString(),
      });
      applyStockLocally(shop!.id, [{ commodityId: body.commodityId, quantity: body.quantity }]);
      setResult({ tone: 'warn', text: t('stock.savedOffline', label) });
    };
    setBusy(true);
    try {
      if (!online) saveOffline();
      else {
        const r = await api.post<{ balanceAfter: number }>('/dealer/stock/receipts', body);
        setResult({ tone: 'ok', text: t('stock.saved', { ...label, now: fmtQty(r.balanceAfter, unitOf(body.commodityId), lang) }) });
        reloadShops();
        ledger.reload();
      }
      setF({ commodityId: '', quantity: '', referenceNo: '', date: todayIst(), note: '' });
    } catch (err) {
      if (isNetworkError(err)) saveOffline();
      else setResult({ tone: 'bad', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  async function notify() {
    setNotifying(true);
    try {
      const r = await api.post<{ notified: number }>(`/dealer/shops/${shop!.id}/notify-ready`);
      setNotified(r.notified ? t('stock.notified', { n: fmtNum(r.notified, lang) }) : t('stock.notifiedNone'));
    } catch (err) {
      setNotified(errorText(err));
    } finally {
      setNotifying(false);
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{t('stock.title')}</h1>

      <section className="grid gap-3 sm:grid-cols-3">
        {shop.stock.map((s) => (
          <Card key={s.commodityId} className="p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-bold">{itemName(s.commodityId)}</h2>
              {s.isLow ? <Badge tone="bad">{t('stock.low')}</Badge> : <Badge tone="ok">{t('stock.ok')}</Badge>}
            </div>
            <p className="mt-1 text-3xl font-bold tabular-nums">{fmtQty(s.quantityAvailable, s.unit, lang)}</p>
            <div className="mt-2"><Meter value={s.quantityAvailable} max={Math.max(s.monthlyQuota, s.quantityAvailable, 1)} tone={s.isLow ? 'bad' : 'brand'} label={itemName(s.commodityId)} /></div>
            <p className="mt-1.5 text-xs text-ink-3">{t('stock.quota', { qty: fmtQty(s.monthlyQuota, s.unit, lang), min: fmtQty(s.lowStockThreshold, s.unit, lang) })}</p>
          </Card>
        ))}
      </section>

      <Card>
        <h2 className="flex items-center gap-2 text-lg font-bold"><PackagePlus className="size-5" aria-hidden />{t('stock.delivery')}</h2>
        <p className="mt-1 text-sm text-ink-3">{t('stock.deliveryHint')}</p>
        <form onSubmit={record} className="mt-4 grid gap-4 sm:grid-cols-2" noValidate>
          <Field label={t('stock.item')}>
            {(id) => (
              <Select id={id} value={f.commodityId} onChange={(e) => setF({ ...f, commodityId: e.target.value })}>
                <option value="">{t('common.choose')}</option>
                {commodities.filter((c) => c.isActive).map((c) => <option key={c.id} value={c.id}>{itemName(c.id)}</option>)}
              </Select>
            )}
          </Field>
          <Field label={`${t('stock.quantity')}${f.commodityId ? ` (${unitLabel(unitOf(Number(f.commodityId)))})` : ''}`}>
            {(id) => <Input id={id} type="number" inputMode="decimal" min={0} step="0.5" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} />}
          </Field>
          <Field label={t('stock.reference')}>
            {(id) => <Input id={id} value={f.referenceNo} onChange={(e) => setF({ ...f, referenceNo: e.target.value })} placeholder={`SFC/${shop.shopCode}/${istMonthKey().slice(0, 7).replace('-', '')}`} />}
          </Field>
          <Field label={t('stock.date')}>
            {(id) => <Input id={id} type="date" max={todayIst()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}
          </Field>
          <Field label={`${t('stock.note')} (${t('common.optional')})`} className="sm:col-span-2">
            {(id) => <Input id={id} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />}
          </Field>
          {result && <Alert tone={result.tone} title={result.text} className="sm:col-span-2" />}
          <Button type="submit" size="lg" loading={busy} className="sm:col-span-2">{t('stock.save')}</Button>
        </form>
      </Card>

      <Card>
        <h2 className="flex items-center gap-2 text-lg font-bold"><Megaphone className="size-5" aria-hidden />{t('stock.notify')}</h2>
        <p className="mt-1 text-sm text-ink-3">{t('stock.notifyHint')}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={notify} loading={notifying} disabled={!online}>{t('stock.notify')}</Button>
          {!online && <span className="text-sm text-warn">{t('stock.needsInternet')}</span>}
          {notified && <span role="status" className="text-sm font-semibold text-ink-2">{notified}</span>}
        </div>
      </Card>

      <Card flush>
        <h2 className="px-5 pt-5 text-lg font-bold">{t('stock.ledger')}</h2>
        {!ledger.data ? (
          ledger.networkError ? <p className="p-5 text-sm text-ink-3">{t('common.notSaved')}</p> : ledger.error ? <Alert tone="bad" title={errorText(ledger.error)} className="m-5" /> : <Loading label={t('common.loading')} />
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {ledger.data.movements.slice(0, 20).map((m) => {
              const c = commodities.find((x) => x.name === m.commodity);
              return (
                <li key={m.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                  <span>
                    <span className="font-semibold">{c ? itemName(c.id) : m.commodity}</span> · {t(`move.${m.type === 'ADJUSTMENT' && m.reason ? m.reason : m.type}` as TKey)}
                    <span className="block text-xs text-ink-3">{fmtDateTime(m.occurredAt, lang)}{m.referenceNo && m.type !== 'ISSUE' ? ` · ${m.referenceNo}` : ''}</span>
                  </span>
                  <span className="shrink-0 whitespace-nowrap text-right">
                    <span className={cx('block font-semibold tabular-nums', m.quantity < 0 ? 'text-bad' : 'text-ok')}>{m.quantity > 0 ? '+' : ''}{fmtQty(m.quantity, m.unit, lang)}</span>
                    <span className="block text-xs text-ink-3 tabular-nums">= {fmtQty(m.balanceAfter, m.unit, lang)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
