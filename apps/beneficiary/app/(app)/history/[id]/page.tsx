'use client';
import { use, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, Printer } from 'lucide-react';
import { Alert, Badge, Button, Card, Loading, fmtDateTime, fmtMoney, fmtQty } from '@srms/ui';
import { api } from '@/lib/client';
import { useI18n } from '@/lib/i18n';
import type { Receipt } from '@/lib/types';

/** FR-3 output: printable / digital receipt (PDF via the browser's "Save as PDF"). */
export default function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, lang } = useI18n();
  const r = api.useGet<Receipt>(`/me/distributions/${id}`);
  if (!r.data) return r.error ? <Alert tone="bad" title={r.error.message} /> : <Loading label={t('common.loading')} />;
  const d = r.data;
  const row = (label: string, value: ReactNode) => (
    <div className="flex justify-between gap-4 py-1.5">
      <dt className="text-ink-3">{label}</dt>
      <dd className="text-right font-semibold">{value}</dd>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="no-print flex items-center justify-between">
        <Link href="/history" className="inline-flex items-center gap-1.5 font-semibold text-brand"><ArrowLeft className="size-4" aria-hidden />{t('common.back')}</Link>
        <Button variant="secondary" size="sm" onClick={() => window.print()}><Printer className="size-4" aria-hidden />{t('common.print')}</Button>
      </div>

      {d.status === 'VOIDED' && <Alert tone="bad" title={t('receipt.voided')} />}

      <Card as="article" className="mx-auto max-w-md print:border-0 print:shadow-none">
        <header className="border-b border-dashed border-line pb-4 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" width={40} height={40} className="mx-auto rounded-lg" />
          <h1 className="mt-2 text-xl font-bold">{t('receipt.title')}</h1>
          <p className="font-mono text-sm text-ink-2">{d.receiptNo}</p>
          {d.status === 'VOIDED' && <Badge tone="bad" className="mt-2">VOID</Badge>}
        </header>

        <dl className="border-b border-dashed border-line py-3 text-sm">
          {row(t('receipt.date'), fmtDateTime(d.issuedAt, lang))}
          {row(t('receipt.shop'), <>{d.shop.name}<span className="block text-xs font-normal text-ink-3">{d.shop.code} · {d.shop.district}</span></>)}
          {row(t('receipt.dealer'), d.dealer.name)}
          {row(t('receipt.holder'), d.beneficiary.name)}
          {row(t('receipt.card'), <span className="font-mono">{d.beneficiary.rationCardNo}</span>)}
          {row(t('receipt.auth'), t(`auth.${d.authMethod}`))}
        </dl>

        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left text-ink-3">
              <th className="py-1.5 font-semibold">{t('receipt.item')}</th>
              <th className="py-1.5 text-right font-semibold">{t('receipt.qty')}</th>
              <th className="py-1.5 text-right font-semibold">{t('receipt.amount')}</th>
            </tr>
          </thead>
          <tbody>
            {d.items.map((i) => (
              <tr key={i.commodityId} className="border-t border-line">
                <td className="py-2 font-semibold">{lang === 'hi' && i.nameHi ? i.nameHi : i.name}</td>
                <td className="py-2 text-right">{fmtQty(i.quantity, i.unit, lang)}</td>
                <td className="py-2 text-right">{fmtMoney(i.amount, lang)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-ink">
              <td className="py-2 font-bold" colSpan={2}>{t('receipt.total')}</td>
              <td className="py-2 text-right font-bold">{fmtMoney(d.totalAmount, lang)}</td>
            </tr>
          </tfoot>
        </table>
        <p className="mt-4 text-center text-xs text-ink-3">{t('receipt.footer')}</p>
      </Card>

      <div className="no-print mx-auto max-w-md text-center">
        <Link href={`/complaints/new?receipt=${encodeURIComponent(d.receiptNo)}`} className="text-sm font-semibold text-brand">{t('receipt.wrong')}</Link>
      </div>
    </div>
  );
}
