'use client';
import Link from 'next/link';
import { Download } from 'lucide-react';
import { Alert, Button, Card, Loading, Meter, PageHeader, cx, fmtMonth } from '@srms/ui';
import { ColumnChart, LineChart } from '@/components/charts';
import { Kpi, coverageStatus, fmtKg, fmtPct, leakageStatus } from '@/components/bits';
import { api, thisMonth } from '@/lib/client';
import { ScopeFilters, scopeQuery, useScope } from '@/lib/scope';
import { CATEGORY_LABEL, type Dashboard } from '@/lib/types';

/** FR-6 Government dashboard: coverage, offtake, leakage, stock and complaints. */
export default function DashboardPage() {
  const scope = useScope();
  const res = api.useGet<Dashboard>(`/official/dashboard?${scopeQuery(scope)}`);
  const d = res.data;
  const prev = d?.trend.at(-2);
  const partial = scope.month === thisMonth();

  return (
    <>
      <PageHeader
        title="Distribution dashboard"
        subtitle={d ? `${fmtMonth(d.month)}${partial ? ' · month in progress' : ''}` : undefined}
        action={
          <Link href="/reports" className="no-print">
            <Button variant="secondary"><Download className="size-4" aria-hidden />Monthly report</Button>
          </Link>
        }
      />
      <ScopeFilters />

      {!d ? (
        res.error ? <Alert tone="bad" title={res.error.message} /> : <Loading />
      ) : (
        // Refetch keeps the frame: previous numbers stay, dimmed, while the new scope loads.
        <div className={cx('space-y-6 transition-opacity', res.loading && 'opacity-60')}>
          <section aria-label="Key indicators" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              label="Coverage"
              value={fmtPct(d.kpis.coveragePct)}
              delta={prev ? d.kpis.coveragePct - prev.coveragePct : undefined}
              period={prev ? fmtMonth(prev.month).split(' ')[0] : undefined}
              hint={`${d.kpis.served.toLocaleString('en-IN')} of ${d.kpis.verifiedBeneficiaries.toLocaleString('en-IN')} served`}
              status={coverageStatus(d.kpis.coveragePct)}
            />
            <Kpi
              label="Offtake"
              value={fmtPct(d.kpis.offtakePct)}
              delta={prev ? d.kpis.offtakePct - prev.offtakePct : undefined}
              period={prev ? fmtMonth(prev.month).split(' ')[0] : undefined}
              hint={`${fmtKg(d.kpis.issued)} of ${fmtKg(d.kpis.allocated)}`}
            />
            <Kpi
              label="Leakage"
              value={fmtPct(d.kpis.leakagePct)}
              delta={prev ? d.kpis.leakagePct - prev.leakagePct : undefined}
              upIsGood={false}
              period={prev ? fmtMonth(prev.month).split(' ')[0] : undefined}
              hint={`wastage ${fmtPct(d.kpis.wastagePct)}`}
              status={leakageStatus(d.kpis.leakagePct)}
            />
            <Kpi
              label="Open complaints"
              value={(d.complaints.open + d.complaints.inProgress).toLocaleString('en-IN')}
              hint={`${d.complaints.inProgress} in progress · ${d.complaints.filedThisMonth} filed this month`}
            />
          </section>

          <section aria-label="Operations" className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3 xl:grid-cols-6">
            {[
              ['Verified beneficiaries', d.kpis.verifiedBeneficiaries],
              ['Awaiting verification', d.kpis.pendingVerification],
              ['Transactions', d.kpis.transactions],
              ['Recorded offline', d.kpis.offlineTransactions],
              ['Active shops', d.kpis.activeShops],
              ['Low-stock items', d.kpis.lowStockItems],
            ].map(([label, v]) => (
              <div key={label} className="rounded-xl border border-line bg-surface px-4 py-3">
                <p className="text-ink-3">{label}</p>
                <p className="mt-0.5 text-xl font-bold">{Number(v).toLocaleString('en-IN')}</p>
              </div>
            ))}
          </section>

          <section className="grid gap-6 xl:grid-cols-[3fr_2fr]">
            <Card>
              <LineChart
                title="Coverage and offtake"
                months={d.trend.map((t) => t.month)}
                series={[
                  { key: 'coverage', label: 'Coverage', color: 'var(--series-1)', values: d.trend.map((t) => t.coveragePct) },
                  { key: 'offtake', label: 'Offtake', color: 'var(--series-2)', values: d.trend.map((t) => t.offtakePct) },
                ]}
              />
            </Card>
            <Card>
              <ColumnChart
                title="Leakage"
                note="shortages found at inspection ÷ stock received"
                months={d.trend.map((t) => t.month)}
                values={d.trend.map((t) => t.leakagePct)}
                color="var(--series-3)"
              />
            </Card>
          </section>

          <section className="grid gap-6 xl:grid-cols-2">
            <Card>
              <h2 className="font-bold">Commodities this month</h2>
              <ul className="mt-4 space-y-5">
                {d.commodities.map((c) => (
                  <li key={c.commodityId}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-semibold">{c.name}</span>
                      <span className="text-sm text-ink-2">
                        <strong className="text-ink">{fmtKg(c.issued)}</strong> issued of {fmtKg(c.allocated)} · {fmtPct(c.offtakePct)}
                      </span>
                    </div>
                    <div className="mt-2">
                      <Meter value={c.issued} max={c.allocated} label={`${c.name} offtake ${fmtPct(c.offtakePct)}`} />
                    </div>
                    <p className="mt-1.5 text-xs text-ink-3">
                      Received {fmtKg(c.received)} · In shops now {fmtKg(c.stock)}
                      {c.leakage > 0 && <> · <span className="font-semibold text-bad">Leakage {fmtKg(c.leakage)}</span></>}
                      {c.wastage > 0 && <> · Wastage {fmtKg(c.wastage)}</>}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>

            <Card>
              <div className="flex items-baseline justify-between">
                <h2 className="font-bold">Open complaints by category</h2>
                <Link href="/complaints" className="text-sm font-semibold text-brand">Open queue</Link>
              </div>
              {d.complaints.openByCategory.length === 0 ? (
                <p className="mt-4 text-ink-3">No open complaints.</p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {d.complaints.openByCategory.map((c) => {
                    const max = d.complaints.openByCategory[0]!.count;
                    return (
                      <li key={c.category} className="grid grid-cols-[9rem_1fr] items-center gap-3 text-sm">
                        <span className="truncate text-ink-2">{CATEGORY_LABEL[c.category] ?? c.category}</span>
                        <span className="flex items-center gap-2">
                          <span className="h-3 rounded-r-[4px] bg-brand" style={{ width: `${(c.count / max) * 85}%`, maxWidth: 'calc(100% - 2rem)' }} aria-hidden />
                          <span className="font-semibold tabular-nums">{c.count}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              <dl className="mt-6 grid grid-cols-3 gap-3 border-t border-line pt-4 text-sm">
                <div><dt className="text-ink-3">Filed this month</dt><dd className="text-lg font-bold">{d.complaints.filedThisMonth}</dd></div>
                <div><dt className="text-ink-3">Resolved this month</dt><dd className="text-lg font-bold">{d.complaints.resolvedThisMonth}</dd></div>
                <div><dt className="text-ink-3">Avg. resolution</dt><dd className="text-lg font-bold">{d.complaints.avgResolutionHours === null ? '—' : d.complaints.avgResolutionHours >= 48 ? `${Math.round(d.complaints.avgResolutionHours / 24)} days` : `${d.complaints.avgResolutionHours} h`}</dd></div>
              </dl>
            </Card>
          </section>

          {d.districts.length > 0 && (
            <Card flush>
              <h2 className="px-5 pt-5 font-bold">Districts</h2>
              <p className="px-5 text-sm text-ink-3">Select a district to drill down.</p>
              <div className="mt-3 overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>District</th><th className="num">Verified</th><th className="num">Served</th><th>Coverage</th>
                      <th className="num">Issued</th><th className="num">Leakage</th><th className="num">Low stock</th><th className="num">Open complaints</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.districts.map((r) => (
                      <tr key={r.districtId} className="cursor-pointer" onClick={() => scope.setDistrictId(r.districtId)}>
                        <td className="font-semibold"><button type="button" className="text-left text-brand hover:underline" onClick={() => scope.setDistrictId(r.districtId)}>{r.name}</button></td>
                        <td className="num">{r.verified}</td>
                        <td className="num">{r.served}</td>
                        <td className="min-w-40"><div className="flex items-center gap-2"><div className="flex-1"><Meter value={r.coveragePct} max={100} label={`${r.name} coverage`} tone={r.coveragePct < 70 ? 'bad' : r.coveragePct < 85 ? 'warn' : 'brand'} /></div><span className="w-12 text-right tabular-nums">{fmtPct(r.coveragePct)}</span></div></td>
                        <td className="num">{fmtKg(r.issued)}</td>
                        <td className={cx('num', r.leakagePct > 0 && 'font-semibold text-bad')}>{fmtPct(r.leakagePct)}</td>
                        <td className="num">{r.lowStock}</td>
                        <td className="num">{r.openComplaints}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <section className="grid gap-6 xl:grid-cols-2">
            <Card flush>
              <h2 className="px-5 pt-5 font-bold">Low stock now</h2>
              <p className="px-5 text-sm text-ink-3">Below 20% of the shop&apos;s monthly quota (SRS R5).</p>
              {d.lowStock.length === 0 ? (
                <p className="px-5 py-6 text-ink-3">Every shop is above its low-stock threshold.</p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="data-table">
                    <thead><tr><th>Shop</th><th>Commodity</th><th className="num">In stock</th><th className="num">Threshold</th></tr></thead>
                    <tbody>
                      {d.lowStock.map((r) => (
                        <tr key={`${r.shopId}-${r.commodity}`}>
                          <td><Link href={`/shops/${r.shopId}`} className="font-semibold text-brand hover:underline">{r.shopName}</Link><span className="block text-xs text-ink-3">{r.shopCode}{r.dealer ? ` · ${r.dealer}` : ''}</span></td>
                          <td>{r.commodity}</td>
                          <td className="num font-semibold text-bad">{fmtKg(r.quantityAvailable)}</td>
                          <td className="num">{fmtKg(r.threshold)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card flush>
              <h2 className="px-5 pt-5 font-bold">Shops with leakage</h2>
              <p className="px-5 text-sm text-ink-3">Last 3 months, from physical stock inspections.</p>
              {d.leakageShops.length === 0 ? (
                <p className="px-5 py-6 text-ink-3">No unexplained shortages recorded.</p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="data-table">
                    <thead><tr><th>Shop</th><th className="num">Received</th><th className="num">Short</th><th className="num">Leakage</th></tr></thead>
                    <tbody>
                      {d.leakageShops.map((r) => (
                        <tr key={r.shopId}>
                          <td><Link href={`/shops/${r.shopId}`} className="font-semibold text-brand hover:underline">{r.shopName}</Link><span className="block text-xs text-ink-3">{r.shopCode}{r.dealer ? ` · ${r.dealer}` : ''}</span></td>
                          <td className="num">{fmtKg(r.received)}</td>
                          <td className="num">{fmtKg(r.leakage)}</td>
                          <td className="num">{leakageStatus(r.leakagePct)} <span className="ml-1 font-semibold">{fmtPct(r.leakagePct)}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </section>
        </div>
      )}
    </>
  );
}
