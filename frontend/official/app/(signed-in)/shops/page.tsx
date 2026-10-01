'use client';
import Link from 'next/link';
import { Badge, Card, Loading, PageHeader } from '@srms/ui-kit';
import { api } from '@/lib/official-api';
import { ScopeFilters, scopeQuery, useScope } from '@/lib/scope';
import type { ShopRow } from '@/lib/official-types';

export default function ShopsPage() {
  const scope = useScope();
  const res = api.useGet<ShopRow[]>(`/official/shops?${scopeQuery(scope, false)}`);
  return (
    <>
      <PageHeader title="Shops & stock" subtitle="Fair price shops, their dealers and live stock position" />
      <ScopeFilters showMonth={false} />
      <Card flush>
        {!res.data ? (
          <Loading />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr><th>Shop</th><th>District</th><th>Dealer</th><th className="num">Beneficiaries</th><th>Stock</th><th className="num">Open complaints</th><th>Status</th></tr>
              </thead>
              <tbody>
                {res.data.map((s) => (
                  <tr key={s.id}>
                    <td><Link href={`/shops/${s.id}`} className="font-semibold text-brand hover:underline">{s.name}</Link><span className="block text-xs text-ink-3">{s.shopCode} · {s.address}</span></td>
                    <td>{s.district}</td>
                    <td>{s.dealer ?? <span className="text-ink-3">Unassigned</span>}{s.dealerMobile && <span className="block text-xs text-ink-3">{s.dealerMobile}</span>}</td>
                    <td className="num">{s.beneficiaries}</td>
                    <td>{s.lowStock > 0 ? <Badge tone="bad">{s.lowStock} low</Badge> : <Badge tone="ok">OK</Badge>}</td>
                    <td className="num">{s.openComplaints || '—'}</td>
                    <td><Badge tone={s.status === 'ACTIVE' ? 'ok' : 'neutral'}>{s.status === 'ACTIVE' ? 'Active' : 'Inactive'}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
