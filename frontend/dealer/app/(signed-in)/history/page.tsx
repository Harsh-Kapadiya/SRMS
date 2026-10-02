'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ChevronRight, CloudOff } from 'lucide-react';
import { Alert, Badge, Button, Card, Empty, Loading, Pager, fmtAgo, fmtDateTime, fmtQty } from '@srms/ui-kit';
import { useCachedGet, useDealer, useErrorText, useItemName } from '@/lib/dealer-api';
import { useI18n } from '@/lib/dealer-i18n';
import type { DistributionRow, Paged } from '@/lib/dealer-types';

/** Entries waiting to be sent (or refused on sync), then everything issued at this shop. */
export default function HistoryPage() {
  const { t, lang } = useI18n();
  const errorText = useErrorText();
  const itemName = useItemName();
  const { shop, queue, removePending, commodities } = useDealer();
  const [page, setPage] = useState(1);
  const list = useCachedGet<Paged<DistributionRow>>(
    shop ? `/dealer/distributions?shopId=${shop.id}&page=${page}` : null,
    shop && page === 1 ? `history:${shop.id}` : null,
  );
  if (!shop) return null;
  const pending = queue.filter((p) => p.shopId === shop.id);
  const unitOf = (id: number) => commodities.find((c) => c.id === id)?.unit ?? 'KG';

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{t('history.title')}</h1>

      {pending.length > 0 && (
        <Card flush>
          <div className="px-5 pt-5">
            <h2 className="flex items-center gap-2 text-lg font-bold text-warn"><CloudOff className="size-5" aria-hidden />{t('history.pending')}</h2>
            <p className="text-sm text-ink-3">{t('history.pendingHint')}</p>
          </div>
          <ul className="mt-3 divide-y divide-line">
            {pending.map((p) => (
              <li key={p.id} className="px-5 py-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <span>
                    <span className="font-semibold">{p.who ?? t('history.delivery')}</span>
                    <span className="block text-ink-2">{p.items.map((i) => `${itemName(i.commodityId)} ${fmtQty(i.quantity, unitOf(i.commodityId), lang)}`).join(' · ')}</span>
                    <span className="block text-xs text-ink-3">{fmtDateTime(p.createdAt, lang)}</span>
                  </span>
                  {p.conflict ? <Badge tone="bad">✕</Badge> : <Badge tone="warn">{t('history.offline')}</Badge>}
                </div>
                {p.conflict && (
                  <div className="mt-2 space-y-2 rounded-lg bg-bad-soft p-3">
                    <p className="font-semibold text-bad">{t('history.conflict', { reason: p.conflict.message })}</p>
                    <p className="text-ink-2">{t('history.conflictHint')}</p>
                    <Button size="sm" variant="secondary" onClick={() => confirm(t('history.removeConfirm')) && removePending(p.id)}>{t('history.remove')}</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card flush>
        <h2 className="px-5 pt-5 text-lg font-bold">{t('history.issued')}</h2>
        {list.savedAt && <p className="px-5 text-xs text-ink-3">{t('common.savedAt', { ago: fmtAgo(list.savedAt, lang) })}</p>}
        {!list.data ? (
          list.networkError ? <p className="p-5 text-sm text-ink-3">{t('common.notSaved')}</p> : list.error ? <Alert tone="bad" title={errorText(list.error)} className="m-5" /> : <Loading label={t('common.loading')} />
        ) : list.data.items.length === 0 ? (
          <Empty title={t('history.empty')} />
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {list.data.items.map((d) => (
              <li key={d.id}>
                <Link href={`/receipt?id=${d.id}`} className="flex items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-surface-2">
                  <span className="min-w-0">
                    <span className="font-semibold">{d.beneficiaryName}</span>
                    <span className="block text-ink-2">{d.items.map((i) => `${lang === 'hi' && i.nameHi ? i.nameHi : i.name} ${fmtQty(i.quantity, i.unit, lang)}`).join(' · ')}</span>
                    <span className="block text-xs text-ink-3">{fmtDateTime(d.issuedAt, lang)} · <span className="font-mono">{d.receiptNo}</span></span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {d.status === 'VOIDED' && <Badge tone="bad">{t('history.voided')}</Badge>}
                      {d.syncedLate ? <Badge tone="bad">{t('history.late')}</Badge> : d.offline && <Badge tone="warn">{t('history.offline')}</Badge>}
                    </span>
                  </span>
                  <ChevronRight className="size-5 shrink-0 text-ink-3" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {list.data && !list.savedAt && <Pager page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />}
    </div>
  );
}
