'use client';
import { useState, type FormEvent } from 'react';
import { CheckCircle2, CloudOff, QrCode, Search } from 'lucide-react';
import { istMonthKey } from '@srms/shared';
import { Alert, ApiError, Badge, Button, Card, Field, Input, OtpInput, cx, fmtMoney, fmtMonth, fmtNum, fmtQty } from '@srms/ui-kit';
import { QrScanner, useQrSupported } from '@/components/qr-scanner';
import { ReceiptCard } from '@/components/receipt-card';
import { api, applyIssueLocally, isNetworkError, rosterKey, useDealer, useErrorText, useItemName } from '@/lib/dealer-api';
import { useI18n, type TKey } from '@/lib/dealer-i18n';
import { load, type Pending } from '@/lib/offline-store';
import type { Lookup, Receipt, Roster } from '@/lib/dealer-types';

/** What the dealer sees after searching — from the API, or from the saved roster when offline. */
interface Found extends Lookup {
  offline: boolean;
}

type Done = { receipt: Receipt } | { saved: Pending; fellBack: boolean };

/** FR-3 + LLD 2.1–2.5: find the card holder, check quota and stock, verify with OTP, issue, print. */
export default function IssuePage() {
  const { t, lang } = useI18n();
  const errorText = useErrorText();
  const itemName = useItemName();
  const { shop, online, commodities, enqueue, reloadShops } = useDealer();
  const qrSupported = useQrSupported();

  const [q, setQ] = useState('');
  const [scanning, setScanning] = useState(false);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState<{ tone: 'bad' | 'warn'; text: string }>();
  const [found, setFound] = useState<Found | null>(null);
  const [qty, setQty] = useState<Record<number, string>>({});
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState<{ to: string; demo?: string } | null>(null);
  const [checked, setChecked] = useState(false);
  const [clientRef, setClientRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<Done | null>(null);

  const unit = (id: number) => commodities.find((c) => c.id === id)?.unit ?? 'KG';

  function reset() {
    setQ('');
    setFound(null);
    setMessage(undefined);
    setOtp('');
    setOtpSent(null);
    setChecked(false);
    setError(undefined);
    setDone(null);
  }

  function show(f: Found) {
    setFound(f);
    setQty(Object.fromEntries(f.lines.map((l) => [l.commodityId, String(l.maxIssuable)])));
    setClientRef(crypto.randomUUID());
  }

  /** Offline: look the card up in this shop's saved roster (this month's quota, saved stock). */
  function searchSaved(card: string) {
    const roster = load<Roster>(rosterKey(shop!.id))?.value;
    if (!roster) return setMessage({ tone: 'warn', text: t('issue.noRoster') });
    if (roster.month !== istMonthKey()) return setMessage({ tone: 'warn', text: t('issue.rosterOld', { month: fmtMonth(roster.month, lang) }) });
    const b = roster.beneficiaries.find((x) => x.rationCardNo === card);
    if (!b) return setMessage({ tone: 'warn', text: t('issue.notInRoster') });
    show({
      offline: true,
      beneficiary: { ...b, familySize: null, portability: false },
      eligible: true,
      reason: null,
      reasonCode: null,
      requireOtp: false,
      lines: b.quota.map((qt) => {
        const inStock = shop!.stock.find((s) => s.commodityId === qt.commodityId)?.quantityAvailable ?? 0;
        return { ...qt, inStock, maxIssuable: Math.min(qt.remaining, inStock), pricePerUnit: commodities.find((c) => c.id === qt.commodityId)?.pricePerUnit ?? 0 };
      }),
    });
  }

  async function search(value = q) {
    const card = value.trim();
    reset();
    setQ(card);
    if (card.length < 4 || !shop) return;
    if (!online) return searchSaved(card);
    setSearching(true);
    try {
      show({ ...(await api.get<Lookup>(`/dealer/lookup?shopId=${shop.id}&q=${encodeURIComponent(card)}`)), offline: false });
    } catch (err) {
      if (isNetworkError(err)) searchSaved(card);
      else setMessage({ tone: 'bad', text: err instanceof ApiError && err.status === 404 ? t('issue.notFound') : errorText(err) });
    } finally {
      setSearching(false);
    }
  }

  /** Quantities as entered, validated against what may be issued. */
  function items(): { commodityId: number; quantity: number }[] | null {
    const list = found!.lines.map((l) => ({ commodityId: l.commodityId, quantity: Number(qty[l.commodityId] || 0), max: l.maxIssuable })).filter((i) => i.quantity > 0);
    const over = list.find((i) => !Number.isFinite(i.quantity) || i.quantity > i.max);
    if (over) {
      setError(t('issue.tooMuch', { item: itemName(over.commodityId), max: fmtQty(over.max, unit(over.commodityId), lang) }));
      return null;
    }
    if (!list.length) {
      setError(t('issue.nothing'));
      return null;
    }
    setError(undefined);
    return list.map(({ commodityId, quantity }) => ({ commodityId, quantity }));
  }

  function saveOffline(list: { commodityId: number; quantity: number }[], fellBack: boolean) {
    const b = found!.beneficiary;
    const pending: Pending = {
      id: clientRef,
      path: '/dealer/distributions',
      body: { shopId: shop!.id, beneficiaryId: b.id, items: list, clientRef, capturedOfflineAt: new Date().toISOString() },
      shopId: shop!.id,
      who: b.name,
      items: list,
      createdAt: new Date().toISOString(),
    };
    enqueue(pending);
    applyIssueLocally(shop!.id, b.id, list, true);
    setDone({ saved: pending, fellBack });
  }

  async function sendOtp() {
    setBusy(true);
    setError(undefined);
    try {
      const r = await api.post<{ sentTo: string; devOtp?: string }>('/dealer/auth-otp', { shopId: shop!.id, beneficiaryId: found!.beneficiary.id });
      setOtpSent({ to: r.sentTo, demo: r.devOtp });
      setOtp('');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function issue(e: FormEvent) {
    e.preventDefault();
    const list = items();
    if (!list) return;
    if (found!.offline) {
      if (!checked) return setError(t('issue.checkFirst'));
      return saveOffline(list, false);
    }
    if (found!.requireOtp && !/^\d{6}$/.test(otp)) return setError(t('otp.invalid'));
    setBusy(true);
    try {
      const receipt = await api.post<Receipt>('/dealer/distributions', {
        shopId: shop!.id, beneficiaryId: found!.beneficiary.id, items: list, clientRef, ...(found!.requireOtp ? { otp } : {}),
      });
      applyIssueLocally(shop!.id, found!.beneficiary.id, list, false); // keep the saved roster in step for later offline use
      reloadShops();
      setDone({ receipt });
    } catch (err) {
      // Sent but no answer: keep it as an offline entry with the same clientRef — if the first
      // request did arrive, the server returns that receipt instead of issuing twice.
      if (isNetworkError(err)) saveOffline(list, true);
      else setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (!shop) return null;

  if (done) {
    return (
      <div className="space-y-4">
        {'receipt' in done ? (
          <>
            <Alert tone="ok" title={<span className="inline-flex items-center gap-2"><CheckCircle2 className="size-5" aria-hidden />{t('issue.done')}</span>} />
            <ReceiptCard r={done.receipt} />
          </>
        ) : (
          <Card className="space-y-3">
            <h2 className="flex items-center gap-2 text-lg font-bold text-warn"><CloudOff className="size-5" aria-hidden />{t('issue.savedOffline')}</h2>
            {done.fellBack && <p className="text-sm text-ink-2">{t('issue.fellBack')}</p>}
            <p className="font-semibold">{done.saved.who}</p>
            <ul className="text-sm">
              {done.saved.items.map((i) => <li key={i.commodityId}>{itemName(i.commodityId)} — {fmtQty(i.quantity, unit(i.commodityId), lang)}</li>)}
            </ul>
            <p className="text-sm text-ink-3">{t('issue.savedOfflineBody')}</p>
          </Card>
        )}
        <div className="no-print flex gap-2">
          {'receipt' in done && <Button variant="secondary" onClick={() => window.print()}>{t('common.print')}</Button>}
          <Button className="flex-1" size="lg" onClick={reset}>{t('issue.next')}</Button>
        </div>
      </div>
    );
  }

  const low = shop.stock.filter((s) => s.isLow);
  const total = found ? found.lines.reduce((sum, l) => sum + Number(qty[l.commodityId] || 0) * l.pricePerUnit, 0) : 0;

  return (
    <div className="space-y-4">
      {!online && <Alert tone="warn" title={t('offline.title')}>{t('offline.body')}</Alert>}

      <section className="grid grid-cols-2 gap-3" aria-label={shop.name}>
        <Card className="p-4">
          <p className="text-sm text-ink-3">{t('home.today')}</p>
          <p className="text-2xl font-bold tabular-nums">{fmtNum(shop.stats.today, lang)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-ink-3">{t('home.served')}</p>
          <p className="text-2xl font-bold tabular-nums">{fmtNum(shop.stats.servedThisMonth, lang)}</p>
          <p className="text-xs text-ink-3">{t('home.ofHome', { n: fmtNum(shop.stats.homeBeneficiaries, lang) })}</p>
        </Card>
      </section>
      {low.length > 0 && (
        <Alert tone="bad" title={t('home.lowStock', { items: low.map((s) => `${itemName(s.commodityId)} ${fmtQty(s.quantityAvailable, s.unit, lang)}`).join(', ') })} />
      )}

      <Card>
        <form onSubmit={(e) => { e.preventDefault(); void search(); }} className="space-y-3" noValidate>
          <Field label={online ? t('issue.searchOnline') : t('issue.search')} hint={online ? undefined : t('issue.searchOfflineHint')}>
            {(id, describedBy) => (
              <Input id={id} aria-describedby={describedBy} value={q} onChange={(e) => setQ(e.target.value)} inputMode={online ? 'text' : 'numeric'} autoComplete="off" className="font-mono text-lg" />
            )}
          </Field>
          <div className="flex gap-2">
            <Button type="submit" className="flex-1" size="lg" loading={searching}><Search className="size-5" aria-hidden />{t('issue.find')}</Button>
            {qrSupported && <Button type="button" variant="secondary" size="lg" onClick={() => setScanning(true)}><QrCode className="size-5" aria-hidden />{t('issue.scan')}</Button>}
          </div>
        </form>
        {message && <Alert tone={message.tone} title={message.text} className="mt-3" />}
      </Card>

      {found && (
        <Card className="space-y-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold">{found.beneficiary.name}</h2>
              <Badge tone="info">{t(`card.${found.beneficiary.cardType}` as TKey)}</Badge>
              {found.beneficiary.portability && <Badge tone="warn">{t('ben.portability')}</Badge>}
              {found.offline && <Badge tone="warn"><CloudOff className="size-3" aria-hidden />{t('status.offline')}</Badge>}
            </div>
            <p className="mt-1 text-sm text-ink-3">
              {t('ben.card', { no: found.beneficiary.rationCardNo ?? '—' })}
              {found.beneficiary.familySize ? ` · ${t('ben.family', { n: found.beneficiary.familySize })}` : ''} · {found.beneficiary.aadhaarMasked}
            </p>
          </div>

          {!found.eligible ? (
            <Alert tone="bad" title={t('issue.notEligible')}>{found.reasonCode ? t(`reason.${found.reasonCode}` as TKey) : found.reason}</Alert>
          ) : (
            <form onSubmit={issue} className="space-y-4" noValidate>
              <ul className="space-y-3">
                {found.lines.map((l) => {
                  const u = unit(l.commodityId);
                  const blocked = l.maxIssuable <= 0;
                  return (
                    <li key={l.commodityId} className={cx('rounded-xl border p-3', blocked ? 'border-line bg-surface-2' : 'border-line')}>
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <span className="font-semibold">{itemName(l.commodityId)}</span>
                        <span className="text-sm text-ink-2">{t('issue.entitled', { left: fmtQty(l.remaining, u, lang), total: fmtQty(l.allocated, u, lang) })}</span>
                      </div>
                      <p className={cx('text-xs', l.inStock < l.remaining ? 'font-semibold text-bad' : 'text-ink-3')}>{t('issue.inStock', { qty: fmtQty(l.inStock, u, lang) })}</p>
                      {blocked ? (
                        <p className="mt-2 text-sm font-semibold text-ink-3">{l.remaining <= 0 ? t('issue.collected') : t('issue.outOfStock')}</p>
                      ) : (
                        <Field label={t('issue.qty', { item: itemName(l.commodityId), max: fmtQty(l.maxIssuable, u, lang) })} className="mt-2">
                          {(id) => (
                            <Input
                              id={id} type="number" inputMode="decimal" min={0} max={l.maxIssuable} step="0.5"
                              value={qty[l.commodityId] ?? ''} onChange={(e) => setQty({ ...qty, [l.commodityId]: e.target.value })}
                              className="w-32 text-lg tabular-nums"
                            />
                          )}
                        </Field>
                      )}
                    </li>
                  );
                })}
              </ul>
              <p className="flex justify-between border-t border-line pt-3 font-semibold">
                <span>{t('issue.toPay')}</span>
                <span className="tabular-nums">{total > 0 ? fmtMoney(total, lang) : t('issue.free')}</span>
              </p>

              {found.offline ? (
                <div className="space-y-3 rounded-xl bg-warn-soft p-3">
                  <p className="text-sm text-ink-2">{t('issue.offlineNote')}</p>
                  <label className="flex items-start gap-2 font-semibold">
                    <input type="checkbox" checked={checked} onChange={(e) => { setChecked(e.target.checked); setError(undefined); }} className="mt-1 size-5 accent-[var(--brand)]" />
                    {t('issue.checkedCard')}
                  </label>
                </div>
              ) : (
                found.requireOtp &&
                (otpSent ? (
                  <div className="space-y-2">
                    <p className="text-sm text-ink-2">{t('otp.sentTo', { mobile: otpSent.to })}</p>
                    {otpSent.demo && <p className="rounded-lg bg-info-soft px-3 py-2 text-sm font-semibold text-info">{t('otp.demo', { otp: otpSent.demo })}</p>}
                    <Field label={t('otp.label')}>{(id) => <OtpInput id={id} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} />}</Field>
                    <button type="button" onClick={sendOtp} className="text-sm font-semibold text-brand underline" disabled={busy}>{t('otp.resend')}</button>
                  </div>
                ) : (
                  <Button type="button" variant="secondary" block size="lg" loading={busy} onClick={sendOtp}>{t('otp.send', { mobile: found.beneficiary.mobileMasked })}</Button>
                ))
              )}

              {error && <Alert tone="bad" title={error} />}
              {(found.offline || !found.requireOtp || otpSent) && (
                <Button type="submit" block size="lg" loading={busy}>
                  {found.offline ? t('issue.saveOffline') : found.requireOtp ? t('issue.confirm') : t('issue.issue')}
                </Button>
              )}
            </form>
          )}
        </Card>
      )}

      <QrScanner open={scanning} onClose={() => setScanning(false)} onResult={(value) => { setScanning(false); void search(value); }} />
    </div>
  );
}
