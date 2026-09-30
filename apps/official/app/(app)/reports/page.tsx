'use client';
import { useState } from 'react';
import { FileSpreadsheet, Printer } from 'lucide-react';
import { Alert, Button, Card, Loading, PageHeader, cx, downloadBlob, fmtDateTime, fmtMonth } from '@srms/ui';
import { fmtKg, fmtPct } from '@/components/bits';
import { api } from '@/lib/client';
import { ScopeFilters, scopeQuery, useScope } from '@/lib/scope';
import type { MonthlyReport } from '@/lib/types';

/** FR-8 monthly reports: district-wise and shop-wise, Excel download or print / save as PDF. */
export default function ReportsPage() {
  const scope = useScope();
  const query = scopeQuery(scope);
  const res = api.useGet<MonthlyReport>(`/official/reports/monthly?${query}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function excel() {
    setBusy(true);
    setError(undefined);
    try {
      downloadBlob(await api.get<Blob>(`/official/reports/monthly?${query}&format=xlsx`), `srms-report-${scope.month}.xlsx`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const r = res.data;
  return (
    <>
      <PageHeader
        title="Monthly report"
        subtitle={r ? `${fmtMonth(r.month)} · generated ${fmtDateTime(r.generatedAt)}` : undefined}
        action={
          <div className="no-print flex gap-2">
            <Button variant="secondary" onClick={() => window.print()} disabled={!r}><Printer className="size-4" aria-hidden />Print / PDF</Button>
            <Button onClick={excel} loading={busy} disabled={!r}><FileSpreadsheet className="size-4" aria-hidden />Excel</Button>
          </div>
        }
      />
      <ScopeFilters />
      {error && <Alert tone="bad" title={error} className="mb-4" />}
      {!r ? (
        res.error ? <Alert tone="bad" title={res.error.message} /> : <Loading />
      ) : (
        <div className={cx('space-y-6', res.loading && 'opacity-60')}>
          <Card flush className="print:border-0">
            <h2 className="px-5 pt-5 font-bold">District-wise summary</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>District</th><th className="num">Shops</th><th className="num">Beneficiaries</th><th className="num">Served</th><th className="num">Coverage</th><th className="num">Allocated</th><th className="num">Received</th><th className="num">Issued</th><th className="num">Offtake</th><th className="num">Wastage</th><th className="num">Leakage</th></tr></thead>
                <tbody>
                  {r.districts.map((d) => (
                    <tr key={d.district}>
                      <td className="font-semibold">{d.district}</td>
                      <td className="num">{d.shops}</td><td className="num">{d.home}</td><td className="num">{d.served}</td><td className="num">{fmtPct(d.coveragePct)}</td>
                      <td className="num">{fmtKg(d.allocated)}</td><td className="num">{fmtKg(d.received)}</td><td className="num">{fmtKg(d.issued)}</td><td className="num">{fmtPct(d.offtakePct)}</td>
                      <td className="num">{fmtKg(d.wastage)}</td><td className={cx('num', d.leakage > 0 && 'font-semibold text-bad')}>{fmtKg(d.leakage)} ({fmtPct(d.leakagePct)})</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card flush className="print:break-before-page print:border-0">
            <h2 className="px-5 pt-5 font-bold">Shop-wise stock ledger</h2>
            <p className="px-5 text-sm text-ink-3">Opening + received − issued − wastage − leakage + excess = closing.</p>
            <div className="mt-3 overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>Shop</th><th>Commodity</th><th className="num">Opening</th><th className="num">Received</th><th className="num">Issued</th><th className="num">Wastage</th><th className="num">Leakage</th><th className="num">Closing</th><th className="num">Allocated</th><th className="num">Offtake</th></tr></thead>
                <tbody>
                  {r.lines.map((l) => {
                    const shop = r.shops.find((s) => s.shopCode === l.shopCode);
                    return (
                      <tr key={`${l.shopCode}-${l.commodity}`}>
                        <td>{shop?.shopName ?? l.shopCode}<span className="block text-xs text-ink-3">{l.shopCode} · {l.district}</span></td>
                        <td>{l.commodity}</td>
                        <td className="num">{l.opening.toLocaleString('en-IN')}</td><td className="num">{l.received.toLocaleString('en-IN')}</td><td className="num">{l.issued.toLocaleString('en-IN')}</td>
                        <td className="num">{l.wastage.toLocaleString('en-IN')}</td><td className={cx('num', l.leakage > 0 && 'font-semibold text-bad')}>{l.leakage.toLocaleString('en-IN')}</td>
                        <td className="num font-semibold">{l.closing.toLocaleString('en-IN')}</td><td className="num">{l.allocated.toLocaleString('en-IN')}</td><td className="num">{fmtPct(l.offtakePct)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card flush className="print:break-before-page print:border-0">
            <h2 className="px-5 pt-5 font-bold">Shop-wise coverage</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>Shop</th><th>Dealer</th><th className="num">Beneficiaries</th><th className="num">Served</th><th className="num">Coverage</th><th className="num">Transactions</th></tr></thead>
                <tbody>
                  {r.shops.map((s) => (
                    <tr key={s.shopId}>
                      <td>{s.shopName}<span className="block text-xs text-ink-3">{s.shopCode} · {s.district}</span></td>
                      <td>{s.dealer}</td><td className="num">{s.home}</td><td className="num">{s.served}</td><td className="num">{fmtPct(s.coveragePct)}</td><td className="num">{s.transactions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
