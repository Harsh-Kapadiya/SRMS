'use client';
import { Alert, Card, fmtDateTime, fmtMoney, fmtQty } from '@srms/ui-kit';
import { useI18n, type TKey } from '@/lib/dealer-i18n';
import type { Receipt } from '@/lib/dealer-types';

/** FR-3 / LLD 2.5: the printable receipt handed to the beneficiary. */
export function ReceiptCard({ r }: { r: Receipt }) {
  const { t, lang } = useI18n();
  return (
    <Card className="space-y-4 print:border-0 print:shadow-none">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{t('receipt.title')}</h2>
          <p className="text-sm text-ink-3">{r.shop.name} · {r.shop.code}</p>
        </div>
        <p className="shrink-0 whitespace-nowrap text-right font-mono text-sm font-semibold">{r.receiptNo}</p>
      </div>
      {r.status === 'VOIDED' && <Alert tone="bad" title={t('receipt.voided')} />}
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div><dt className="text-ink-3">{t('receipt.date')}</dt><dd className="font-semibold">{fmtDateTime(r.issuedAt, lang)}</dd></div>
        <div><dt className="text-ink-3">{t('receipt.verified')}</dt><dd className="font-semibold">{t(`auth.${r.authMethod}` as TKey)}</dd></div>
        <div className="col-span-2">
          <dt className="text-ink-3">{t('receipt.beneficiary')}</dt>
          <dd className="font-semibold">{r.beneficiary.name}</dd>
          <dd className="text-ink-3">{r.beneficiary.rationCardNo} · {r.beneficiary.cardType} · {r.beneficiary.aadhaarMasked}</dd>
        </div>
      </dl>
      <table className="w-full text-sm">
        <thead><tr className="border-b border-line text-left text-ink-3"><th className="py-1.5 font-semibold">{t('receipt.item')}</th><th className="py-1.5 text-right font-semibold">{t('receipt.qty')}</th><th className="py-1.5 text-right font-semibold">{t('receipt.amount')}</th></tr></thead>
        <tbody>
          {r.items.map((i) => (
            <tr key={i.commodityId} className="border-b border-line">
              <td className="py-1.5">{lang === 'hi' && i.nameHi ? i.nameHi : i.name}</td>
              <td className="py-1.5 text-right tabular-nums">{fmtQty(i.quantity, i.unit, lang)}</td>
              <td className="py-1.5 text-right tabular-nums">{fmtMoney(i.amount, lang)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td colSpan={2} className="py-1.5 font-bold">{t('receipt.total')}</td><td className="py-1.5 text-right font-bold tabular-nums">{fmtMoney(r.totalAmount, lang)}</td></tr></tfoot>
      </table>
      <p className="text-xs text-ink-3">
        {t('receipt.dealer')}: {r.dealer.name} · {r.dealer.licenseNo}
        {r.capturedOfflineAt && <><br />{t('receipt.offlineAt', { date: fmtDateTime(r.capturedOfflineAt, lang) })}</>}
      </p>
    </Card>
  );
}
