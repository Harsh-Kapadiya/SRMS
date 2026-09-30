'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, ReceiptText } from 'lucide-react';
import { Badge, Button, Card, Empty, Loading, PageHeader, fmtDate, fmtMonth, fmtQty } from '@srms/ui';
import { api } from '@/lib/client';
import { useI18n } from '@/lib/i18n';
import type { DistributionRow, Paged } from '@/lib/types';

export default function HistoryPage() {
  const { t, lang } = useI18n();
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<DistributionRow[]>([]);
  const res = api.useGet<Paged<DistributionRow>>(`/me/distributions?page=${page}&pageSize=20`);

  useEffect(() => {
    if (res.data) setRows((prev) => (page === 1 ? res.data!.items : [...prev, ...res.data!.items]));
  }, [res.data, page]);

  if (res.loading && !rows.length) return <Loading label={t('common.loading')} />;

  // Group receipts by IST month.
  const groups = new Map<string, DistributionRow[]>();
  for (const r of rows) {
    const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).format(new Date(r.issuedAt));
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  return (
    <>
      <PageHeader title={t('history.title')} />
      {!rows.length ? (
        <Card><Empty icon={<ReceiptText className="size-10" />} title={t('history.empty')}>{t('history.emptyBody')}</Empty></Card>
      ) : (
        <div className="space-y-6">
          {[...groups].map(([month, items]) => (
            <section key={month}>
              <h2 className="mb-2 px-1 text-sm font-bold uppercase tracking-wide text-ink-3">{fmtMonth(`${month}-01`, lang)}</h2>
              <Card className="p-0">
                <ul className="divide-y divide-line">
                  {items.map((d) => (
                    <li key={d.id}>
                      <Link href={`/history/${d.id}`} className="flex items-center gap-3 px-5 py-4 hover:bg-surface-2">
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="flex items-center gap-2 font-semibold">
                            {fmtDate(d.issuedAt, lang)}
                            {d.status === 'VOIDED' && <Badge tone="bad">✕</Badge>}
                          </p>
                          <p className="text-sm text-ink-2">{d.items.map((i) => `${lang === 'hi' && i.nameHi ? i.nameHi : i.name} ${fmtQty(i.quantity, i.unit, lang)}`).join(' · ')}</p>
                          <p className="truncate text-xs text-ink-3">{d.shopName} · {d.receiptNo}</p>
                        </div>
                        <ChevronRight className="size-5 text-ink-3" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          ))}
          {res.data && rows.length < res.data.total && (
            <Button variant="secondary" block loading={res.loading} onClick={() => setPage((p) => p + 1)}>{t('history.more')}</Button>
          )}
        </div>
      )}
    </>
  );
}
