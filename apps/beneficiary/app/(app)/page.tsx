'use client';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import { CheckCircle2, ChevronRight, CircleAlert, MessageSquareWarning, Store, Users } from 'lucide-react';
import { Alert, Badge, Button, Card, Empty, Loading, Meter, fmtDate, fmtMonth, fmtQty } from '@srms/ui';
import { api, useMe } from '@/lib/client';
import { useI18n } from '@/lib/i18n';
import type { DistributionRow, Entitlement, Paged } from '@/lib/types';

export default function HomePage() {
  const { t, lang } = useI18n();
  const { me } = useMe();
  const b = me.beneficiary!;
  const verified = b.verificationStatus === 'VERIFIED';
  const ent = api.useGet<Entitlement>(verified ? '/me/entitlement' : null);
  const recent = api.useGet<Paged<DistributionRow>>(verified ? '/me/distributions?pageSize=3' : null);

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{t('home.hello', { name: b.name.split(' ')[0]! })}</h1>

      {b.verificationStatus === 'PENDING' && (
        <Alert tone="warn" title={t('home.pending.title')} action={<Link href="/verify"><Button size="sm">{t('home.pending.cta')}</Button></Link>}>
          {t('home.pending.body', { reg: b.registrationNo })}
        </Alert>
      )}
      {b.verificationStatus === 'REJECTED' && (
        <Alert tone="bad" title={t('home.rejected.title')} action={<Link href="/verify"><Button size="sm" variant="danger">{t('common.retry')}</Button></Link>}>
          {b.rejectionReason}
        </Alert>
      )}

      {/* Ration card */}
      <section aria-label={t('home.card')} className="relative overflow-hidden rounded-[1.25rem] bg-gradient-to-br from-brand-strong to-brand p-5 text-on-brand shadow-lg">
        <div className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-white/10" aria-hidden />
        <div className="relative flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-3">
            <div>
              <p className="text-sm font-semibold opacity-80">{t('home.card')}</p>
              <p className="mt-0.5 whitespace-nowrap font-mono text-xl font-bold tracking-wide min-[400px]:text-2xl">
                {b.rationCardNo ? b.rationCardNo.replace(/(\d{4})(?=\d)/g, '$1 ') : '—'}
              </p>
              {!b.rationCardNo && <p className="text-sm opacity-80">{t('home.cardPending')}</p>}
            </div>
            <p className="text-lg font-semibold">{b.name}</p>
            <div className="flex flex-wrap gap-2 text-sm">
              <span className="rounded-full bg-white/15 px-2.5 py-1 font-semibold">{t(`card.${b.cardType}`)}</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1"><Users className="size-4" aria-hidden />{t('home.members', { n: b.familySize })}</span>
            </div>
          </div>
          {b.rationCardNo && (
            <figure className="shrink-0 text-center">
              <div className="rounded-xl bg-white p-2">
                <QRCodeSVG value={b.rationCardNo} size={92} level="M" />
              </div>
              <figcaption className="mt-1 max-w-24 text-[11px] leading-tight opacity-85">{t('home.showDealer')}</figcaption>
            </figure>
          )}
        </div>
        {b.homeShop && (
          <p className="relative mt-4 flex items-center gap-2 border-t border-white/20 pt-3 text-sm">
            <Store className="size-4 shrink-0" aria-hidden />
            <span className="opacity-80">{t('home.homeShop')}:</span>
            <span className="truncate font-semibold">{b.homeShop.name}</span>
          </p>
        )}
      </section>

      {/* FR-3 / FR-4: this month's entitlement and availability */}
      <Card>
        <h2 className="flex items-baseline justify-between gap-2 text-lg font-bold">
          {t('home.thisMonth')}
          {ent.data && <span className="text-sm font-semibold text-ink-3">{fmtMonth(ent.data.month, lang)}</span>}
        </h2>
        {!verified ? (
          <p className="mt-3 text-ink-3">{t('home.notVerified')}</p>
        ) : ent.loading && !ent.data ? (
          <Loading label={t('common.loading')} />
        ) : !ent.data?.lines.length ? (
          <p className="mt-3 text-ink-3">{t('home.noEntitlement')}</p>
        ) : (
          <ul className="mt-4 space-y-5">
            {ent.data.lines.map((l) => {
              const done = l.remaining <= 0;
              return (
                <li key={l.commodityId}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-lg font-semibold">{lang === 'hi' && l.nameHi ? l.nameHi : l.name}</span>
                    {done ? (
                      <Badge tone="ok"><CheckCircle2 className="size-3.5" aria-hidden />{t('home.collected')}</Badge>
                    ) : (
                      <span className="font-semibold text-ink-2">{t('home.left', { left: fmtQty(l.remaining, l.unit, lang), total: fmtQty(l.allocated, l.unit, lang) })}</span>
                    )}
                  </div>
                  <div className="mt-2">
                    <Meter value={l.issued} max={l.allocated} label={`${l.name}: ${l.issued}/${l.allocated}`} />
                  </div>
                  {!done && (
                    <p className={`mt-1.5 flex items-center gap-1.5 text-sm ${l.availableAtShop ? 'text-ok' : 'text-warn'}`}>
                      {l.availableAtShop ? <CheckCircle2 className="size-4" aria-hidden /> : <CircleAlert className="size-4" aria-hidden />}
                      {t(l.availableAtShop ? 'home.atShop' : 'home.notAtShop')}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {verified && (
        <Card flush>
          <div className="flex items-center justify-between px-5 pt-5">
            <h2 className="text-lg font-bold">{t('home.recent')}</h2>
            <Link href="/history" className="text-sm font-semibold text-brand">{t('common.viewAll')}</Link>
          </div>
          {recent.data?.items.length ? (
            <ul className="mt-2 divide-y divide-line">
              {recent.data.items.map((d) => (
                <li key={d.id}>
                  <Link href={`/history/${d.id}`} className="flex items-center gap-3 px-5 py-3.5 hover:bg-surface-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{fmtDate(d.issuedAt, lang)}</p>
                      <p className="truncate text-sm text-ink-3">{d.items.map((i) => `${lang === 'hi' && i.nameHi ? i.nameHi : i.name} ${fmtQty(i.quantity, i.unit, lang)}`).join(' · ')}</p>
                    </div>
                    <ChevronRight className="size-5 text-ink-3" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title={t('home.noHistory')} />
          )}
        </Card>
      )}

      <Link href="/complaints/new" className="flex items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 hover:bg-surface-3">
        <span className="flex size-10 items-center justify-center rounded-full bg-accent-soft text-accent"><MessageSquareWarning className="size-5" aria-hidden /></span>
        <span className="flex-1 font-semibold">{t('home.report')}</span>
        <ChevronRight className="size-5 text-ink-3" aria-hidden />
      </Link>
    </div>
  );
}
